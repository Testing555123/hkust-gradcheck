"""字符区间 -> 页码 -> chunk_id 的映射层（双 pass 溯源链的底座）。

langextract 的第二 pass 给出的是**字符区间**（char_interval），而 ParsedDocument
只按页组织文本。这一层负责把两者接起来：

    char 偏移 -> 页码 -> 稳定 chunk_id

chunk_id 必须可复现（同一份 PDF 同一段文本永远得到同一个 id），
否则规则层回指切片、人工复核对照原文都会失效。

设计约束：
- 偏移量相对 `ParsedDocument.text_with_page_markers()` 计算，与喂给 LLM 的字符串同源；
- `full[char_start:char_end] == text` 恒成立（测试断言），保证溯源不是假货；
- 不解析 PDF、不调用网络，纯字符串计算。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from parsers.base import ParsedDocument

# 单个切片的最大字符数。毕业要求 PDF 每页通常几十行，800 字符足够切成
# 「一个要求组 / 一段课程表」的粒度，又不至于让切片数量爆炸。
MAX_CHUNK_CHARS = 800


@dataclass(frozen=True)
class Chunk:
    """一段可溯源的原文。"""

    chunk_id: str
    page: int  # 1-based 页码
    ordinal: int  # 页内序号，从 0 开始
    char_start: int  # 相对 text_with_page_markers() 的字符偏移
    char_end: int
    text: str


def chunk_id_for(program_key: str, page: int, ordinal: int, text: str) -> str:
    """稳定切片 id：sha1 前 16 位十六进制。

    program_key 形如 "2026-27/COMP"，保证不同专业的同名段落不会撞 id。
    """
    raw = f"{program_key}|{page}|{ordinal}|{text}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _page_layout(doc: ParsedDocument) -> tuple[str, dict[int, int]]:
    """复刻 text_with_page_markers() 的拼接，同时记录每页正文的起始偏移。

    不直接复用 doc.text_with_page_markers() 是因为需要页级偏移；
    这里用完全相同的拼接规则重建，偏移量才对得上。
    """
    pages = sorted(doc.pages)
    parts = [f"===== [PAGE {p}] =====\n{doc.pages.get(p, '').strip()}" for p in pages]
    full = "\n\n".join(parts)

    offsets: dict[int, int] = {}
    cursor = 0
    for page, part in zip(pages, parts):
        offsets[page] = cursor + len(f"===== [PAGE {page}] =====\n")
        cursor += len(part) + len("\n\n")
    return full, offsets


def _slices(text: str, max_chars: int) -> list[tuple[int, int]]:
    """按行聚合成不超过 max_chars 的片段，返回 (start, end) 页内偏移。"""
    if not text:
        return []

    out: list[tuple[int, int]] = []
    start = 0
    end = 0
    for line in text.split("\n"):
        line_end = end + len(line)
        if end > start and (line_end - start) > max_chars:
            out.append((start, end))
            start = end
        end = line_end + 1  # +1 跳过换行符

    if end > start:
        out.append((start, min(end, len(text))))
    return out


def build_chunks(
    doc: ParsedDocument,
    program_key: str,
    max_chars: int = MAX_CHUNK_CHARS,
) -> list[Chunk]:
    """把解析结果切成可溯源片段，偏移量对齐 text_with_page_markers()。"""
    _, offsets = _page_layout(doc)

    chunks: list[Chunk] = []
    for page in sorted(doc.pages):
        page_text = doc.pages.get(page, "").strip()
        base = offsets[page]
        for ordinal, (start, end) in enumerate(_slices(page_text, max_chars)):
            text = page_text[start:end]
            chunks.append(
                Chunk(
                    chunk_id=chunk_id_for(program_key, page, ordinal, text),
                    page=page,
                    ordinal=ordinal,
                    char_start=base + start,
                    char_end=base + end,
                    text=text,
                )
            )
    return chunks


def locate(chunks: list[Chunk], char_start: int, char_end: int) -> Chunk | None:
    """找出与给定字符区间相交的第一个切片；没有则返回 None。

    返回 None 意味着 langextract 给的区间落不到任何切片上，
    调用方应把它当作「无法溯源」处理（防幻觉闸门）。
    """
    for chunk in chunks:
        if char_start < chunk.char_end and chunk.char_start < char_end:
            return chunk
    return None
