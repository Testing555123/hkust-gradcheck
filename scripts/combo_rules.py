"""官方 Note 里的组合规则（OR / AND）确定性解析器（纯函数，无 I/O）。

支持**两套语法族**：

**1. 关键字族（官方 PDF 原文，最可靠）**

    expr   := term (OR term)*          # 互斥选项，择其一（OR 优先级低于 AND）
    term   := factor (AND factor)*     # 捆绑：每个 factor 都要
    factor := '(' expr ')' | '[' expr ']' | CODE

**2. 符号族（部分产物由抽取阶段写成：`+` 表示且、`/` 表示或）**

    `A + B`            == A AND B
    `one of A / B / C` == (A OR B OR C)，作为一个捆绑 part
    `A / B`            == A OR B（`/` 绑定优先于 `+`）
    `A or B`           == 相邻课号间的小写 or 也视为 OR（`level 3 or above` 这类散文不受影响）

    句首散文会被跳过（如 `Core required (lower-bound): EMIA 2010A (0) + ...`），
    表达式中间遇到英文单词即停止截断；课号后的括号学分 `(3)` / `(4-5)` / `(0 cr)`
    在切词前剥离（学分以 courses.db 为权威，括号值仅作兜底参考）。

**保守原则**：宁可漏识别，不可误判——误判成组合会直接算错学分。
行为被 `scripts/tests/test_combo_rules.py` 双向锁定。

**产出结构**

- OR 组合：`{"kind": "or", "options": [{"parts": [[code, ...], ...]}, ...]}`
- AND 组合：`{"kind": "and", "parts": [[code, ...], ...]}`
- 未识别片段：`unresolved` 列表，供人工校对报告使用

用法：
    from combo_rules import parse_combos, parse_lines
    combos, unresolved = parse_combos(note_text)      # 兼容入口
    for rec in parse_lines(note_text): ...            # 带语法族标记（抽样报告用）
"""

from __future__ import annotations

import re

# 课号：2~5 个字母 + 4 位数字（可含 1 个尾字母，如 COMP 1022P），允许中间一个空格
CODE_RE = re.compile(r"\b[A-Z]{2,5}\s?\d{4}[A-Z]?\b")
# 课号后的括号学分："(3)" / "(4-5)" / "(0 cr)" / "(3 credits)"
CREDIT_PAREN_RE = re.compile(
    r"\(\s*\d+(?:\s*-\s*\d+)?\s*(?:cr|credit|credits)?\.?\s*\)", re.IGNORECASE
)
# 只认大写关键字（小写 and 视为散文）
TOKEN_RE = re.compile(
    r"(?P<code>\b[A-Z]{2,5}\s?\d{4}[A-Z]?\b)"
    r"|(?P<or>\bOR\b)"
    r"|(?P<and>\bAND\b)"
    r"|(?P<oneof>\bone\s+of\b)"
    r"|(?P<slash>/)"
    r"|(?P<plus>\+)"
    r"|(?P<lp>[(\[])"
    r"|(?P<rp>[)\]])"
    r"|(?P<word>[A-Za-z][A-Za-z0-9'’./&+-]*)"
)
# 行首的说明前缀，可重复出现（"Note: A OR B. Note: C OR D"）
NOTE_PREFIX_RE = re.compile(r"^\s*(?:note|notes)\s*[:\-]\s*", re.IGNORECASE)

# 散文体噪音：这些句子里的 or / and 不是组合规则，命中整行跳过
PROSE_MARKERS = (
    "exempted",
    "exempt",
    "or above",
    "or higher",
    "one of the tracks",
    # 只匹配「须跟随某个 Track」的祈使句式；"following IRE Track" 这类
    # 真实组合句的补充说明不能误伤
    "should follow",
    "follow one of",
    "follow the curriculum",
    "follow the applied",
    "approval",
    "approved by",
    "please refer",
    "students should",
    "double counting",
    "may not be reused",
)


def normalize_code(raw: str) -> str:
    """课号规范化：去空格、大写（"MATH 2421" -> "MATH2421"）。"""
    return re.sub(r"\s+", "", raw).upper()


def _strip_note_prefix(line: str) -> str:
    """去掉行首可能重复的 "Note:" / "Notes:" 前缀。"""
    prev = None
    while prev != line:
        prev = line
        line = NOTE_PREFIX_RE.sub("", line)
    return line.strip()


def _is_prose(line: str) -> bool:
    low = line.lower()
    return any(marker in low for marker in PROSE_MARKERS)


def _dedupe(codes: list[str]) -> list[str]:
    out: list[str] = []
    for c in codes:
        if c not in out:
            out.append(c)
    return out


def _normalize_text(line: str) -> str:
    """剥离课号后的括号学分：`(3)` / `(4-5)` / `(0 cr)` 不参与结构。

    替换为等长以外的空白不影响 token 区间（区间基于替换后的文本计算）。
    """
    return CREDIT_PAREN_RE.sub(" ", line)


def _tokenize(text: str) -> list[tuple[str, str, int, int]]:
    """切词：code / or / and / one of / 斜杠 / 加号 / 括号 / 其它英文单词。

    - 右括号必须保留：否则括号内表达式会越过 ")" 把后续的 AND 一并吞掉；
    - 小写 or 单独成 oneor 类别，仅在「两侧紧邻课号」时才被当作 OR（见 _Parser）；
    - 每枚 token 带字符区间，斜杠链/小写 or 需要「间隔只有空白」才算相邻——
      否则 `ECON 2103/2113/2123; FINA 2203/2303` 里被跳过的裸数字会让
      两条互不相干的斜杠链拼成一条（把三个小组并成一个择一，语义就错了）。
    """
    tokens: list[tuple[str, str, int, int]] = []
    for m in TOKEN_RE.finditer(text):
        kind = m.lastgroup or "word"
        if kind == "word" and m.group(0).lower() == "or":
            kind = "oneor"
        tokens.append((kind, m.group(0), m.start(), m.end()))
    return tokens


def _to_parts(node) -> list[list[str]]:
    """把语法树摊平成 parts：part 内是「选一门」的备选，part 之间为 AND。"""
    if node[0] == "code":
        return [[node[1]]]
    if node[0] == "and":
        parts: list[list[str]] = []
        for factor in node[1]:
            parts.extend(_to_parts(factor))
        return [p for p in (_dedupe(part) for part in parts) if p]
    # or 节点作为上一层的一个 part：备选并列
    codes: list[str] = []
    for term in node[1]:
        for part in _to_parts(term):
            codes.extend(part)
    deduped = _dedupe(codes)
    return [deduped] if deduped else []


def _same_parts(a: list[list[str]], b: list[list[str]]) -> bool:
    return [sorted(p) for p in a] == [sorted(p) for p in b]


class _Parser:
    """递归下降解析（OR 优先级低于 AND，`/` 与 `one of` 绑定最紧）。

    起点由调用方定位到第一个课号（句首散文直接跳过）；表达式中间遇到
    无法理解的 token（英文单词、空括号）即停止，把已解析的部分交还调用方。
    """

    def __init__(self, tokens: list[tuple[str, str, int, int]], text: str = "") -> None:
        self.tokens = tokens
        self.text = text
        self.i = 0
        self.used_symbol = False
        # 是否真的消费过运算符：用于区分「语义不明」与「这句话本来就没有组合」
        self.used_operator = False

    # ── 基础工具 ────────────────────────────────────────────────────────
    def peek(self, offset: int = 0):
        idx = self.i + offset
        return self.tokens[idx] if idx < len(self.tokens) else None

    def _is_code_at(self, offset: int) -> bool:
        tok = self.peek(offset)
        return bool(tok and tok[0] == "code")

    def _is_kind_at(self, offset: int, kinds: tuple[str, ...]) -> bool:
        tok = self.peek(offset)
        return bool(tok and tok[0] in kinds)

    def _adjacent(self, a_idx: int, b_idx: int) -> bool:
        """两枚 token 之间只有空白（`A / B` 合法，`A 2113 / B` 不合法）。"""
        if a_idx < 0 or b_idx >= len(self.tokens):
            return False
        return self.text[self.tokens[a_idx][3] : self.tokens[b_idx][2]].strip() == ""

    def _consume_or(self) -> bool:
        """当前位置是否是 OR 运算符（大写 OR / 斜杠 / 相邻小写 or / one of）。"""
        tok = self.peek()
        if not tok:
            return False
        kind = tok[0]
        if kind == "or":
            self.used_operator = True
            return True
        if kind == "slash":
            # 斜杠必须紧贴两侧的课程项：否则 `FINA 2203/2303; MGMT 1110` 里
            # 被跳过的裸数字会让表达式层跨过 "; 2303" 把两门课并成一个择一
            before_ok = self._is_kind_at(-1, ("code", "rp"))
            after_ok = self._is_kind_at(1, ("code", "lp"))
            if (
                before_ok
                and after_ok
                and self._adjacent(self.i - 1, self.i)
                and self._adjacent(self.i, self.i + 1)
            ):
                self.used_operator = True
                return True
            return False
        if kind == "oneor":
            # 小写 or 仅在「两侧紧邻课号、且间隔只有空白」时才是运算符
            # （"EMIA 4990 (0) or EMIA 4991 (3)" 是，`level 3 or above` 不是）
            if (
                self._is_code_at(-1)
                and self._is_code_at(1)
                and self._adjacent(self.i - 1, self.i)
                and self._adjacent(self.i, self.i + 1)
            ):
                self.used_operator = True
                return True
            return False
        return False

    # ── 语法规则 ────────────────────────────────────────────────────────
    def parse_expr(self):
        """expr := term (OR term)*"""
        first = self.parse_term()
        if first is None:
            return None
        terms = [first]
        while self._consume_or():
            tok = self.peek()
            if tok and tok[0] in ("slash", "oneor"):
                self.used_symbol = True
            self.i += 1
            nxt = self.parse_term()
            if nxt is None:
                self.i -= 1
                break
            terms.append(nxt)
        return terms[0] if len(terms) == 1 else ("or", terms)

    def parse_term(self):
        """term := factor (AND factor)*"""
        first = self.parse_factor()
        if first is None:
            return None
        factors = [first]
        while True:
            tok = self.peek()
            if not tok or tok[0] not in ("and", "plus", "oneof"):
                break
            if tok[0] == "plus":
                self.used_symbol = True
            self.used_operator = True
            self.i += 1
            nxt = self.parse_choice() if tok[0] == "oneof" else self.parse_factor()
            if nxt is None:
                self.i -= 1
                break
            factors.append(nxt)
        return factors[0] if len(factors) == 1 else ("and", factors)

    def parse_factor(self):
        """factor := '(' expr ')' | '[' expr ']' | CODE ('/' CODE)*"""
        tok = self.peek()
        if not tok:
            return None
        kind, text = tok[0], tok[1]
        if kind == "lp":
            self.i += 1
            node = self.parse_expr()
            if node is None:
                return None  # 空括号 / 括号内是说明文字：不是组合
            nxt = self.peek()
            if nxt and nxt[0] == "rp":
                self.i += 1
            return node
        if kind == "code":
            self.i += 1
            codes = [normalize_code(text)]
            # 斜杠备选：A / B / C（绑定优先于 AND）；要求 token 真正相邻，
            # 否则 `ECON 2103/2113/2123; FINA 2203/2303` 会把互不相干的链并成一条
            while True:
                nxt = self.peek()
                if not nxt or nxt[0] != "slash":
                    break
                if not self._is_code_at(1):
                    break
                if not (self._adjacent(self.i - 1, self.i) and self._adjacent(self.i, self.i + 1)):
                    break
                self.used_symbol = True
                self.i += 1
                codes.append(normalize_code(self.tokens[self.i][1]))
                self.i += 1
            deduped = _dedupe(codes)
            if len(deduped) == 1:
                return ("code", deduped[0])
            return ("or", [("code", c) for c in deduped])
        if kind == "oneof":
            # one of A / B / C（也可能出现在 factor 位置）
            self.i += 1
            self.used_symbol = True
            return self.parse_choice()
        return None

    def parse_choice(self):
        """one of 之后的备选列表：factor (/ factor)*"""
        first = self.parse_factor()
        if first is None:
            return None
        items = [first]
        while True:
            tok = self.peek()
            if not tok or tok[0] != "slash":
                break
            nxt_tok = self.peek(1)
            if not (self._is_code_at(1) or (nxt_tok and nxt_tok[0] == "lp")):
                break
            if not (self._adjacent(self.i - 1, self.i) and self._adjacent(self.i, self.i + 1)):
                break
            self.used_symbol = True
            self.i += 1
            nxt = self.parse_factor()
            if nxt is None:
                self.i -= 1
                break
            items.append(nxt)
        return items[0] if len(items) == 1 else ("or", items)


def _node_to_combo(node) -> dict | None:
    """语法树 → 组合结构；不足以构成组合（选项/part 不足）时返回 None。"""
    if node[0] == "or":
        options: list[list[list[str]]] = []
        for term in node[1]:
            parts = [p for p in _to_parts(term) if p]
            if parts and not any(_same_parts(parts, o) for o in options):
                options.append(parts)
        if len(options) >= 2:
            return {"kind": "or", "options": [{"parts": p} for p in options]}
        return None
    if node[0] == "and":
        parts = [p for p in _to_parts(node) if p]
        if len(parts) >= 2:
            return {"kind": "and", "parts": parts}
        return None
    return None  # 单个课号


def _parse_line(line: str) -> tuple[list[dict], list[str], bool]:
    """解析单行，返回 (组合列表, 未识别片段, 是否用了符号语法)。

    起点策略：句首散文要跳过（`Core required (lower-bound): EMIA 2010A ...`），
    但**不能直接跳到第一个课号**——那样会丢掉行首的括号（`(A AND B) OR C` 会被
    解析成 `A AND B`）。因此按候选起点（课号或左括号）依次尝试，取第一个能产出
    有效组合的位置。
    """
    # 快速筛除：两套语法族的运算符（大写 OR/AND、+/ 符号、one of、小写 or）都没有则跳过。
    # 注意小写 and 不算运算符（英文连接词），因此这里只针对 OR / or / one of 放宽大小写。
    if not re.search(r"[+/]|\bOR\b|\bAND\b|\bone\s+of\b|\bor\b", line, re.IGNORECASE):
        return [], [], False
    if _is_prose(line):
        return [], [], False

    text = _normalize_text(line)
    tokens = _tokenize(text)
    candidates = [i for i, (kind, *_) in enumerate(tokens) if kind in ("code", "lp")]
    if not candidates:
        return [], [], False

    consumed_operator = False
    used_symbol = False
    for start in candidates:
        parser = _Parser(tokens, text)
        parser.i = start
        node = parser.parse_expr()
        if node is not None:
            combo = _node_to_combo(node)
            if combo:
                return [combo], [], parser.used_symbol
        if parser.used_operator:
            consumed_operator = True
            used_symbol = used_symbol or parser.used_symbol

    # 消费过运算符却拼不出组合 → 语义不明，进人工校对清单；
    # 纯粹「有课号但没运算符」（如小写 and 连接的两门课）不算问题，静默跳过
    if consumed_operator:
        return [], [line.strip()], used_symbol
    return [], [], False


def parse_lines(note: str | None) -> list[dict]:
    """逐行解析，返回带语法族标记的记录（供导出层生成抽样校对报告）。

    记录：{"line": 原文, "combos": [...], "unresolved": [...], "syntax": "symbol"|"keyword"}
    """
    records: list[dict] = []
    if not note or not note.strip():
        return records
    for raw_line in note.splitlines():
        line = _strip_note_prefix(raw_line)
        combos, unresolved, used_symbol = _parse_line(line)
        if combos or unresolved:
            records.append(
                {
                    "line": raw_line.strip(),
                    "combos": combos,
                    "unresolved": unresolved,
                    "syntax": "symbol" if used_symbol else "keyword",
                }
            )
    return records


def parse_combos(note: str | None) -> tuple[list[dict], list[str]]:
    """兼容入口：返回 (全部组合, 全部未识别片段)。"""
    combos: list[dict] = []
    unresolved: list[str] = []
    for rec in parse_lines(note):
        combos.extend(rec["combos"])
        unresolved.extend(rec["unresolved"])
    return combos, unresolved
