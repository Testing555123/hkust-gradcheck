"""LLM 结构化抽取层：ParsedDocument -> ExtractionResult。

模式（借鉴 LangExtract）：带页码标记的全文 + Pydantic Schema + JSON mode，
每个抽取项必须携带 source_pages 页码引用，可回溯 PDF 原文。

环境变量：
    GRAD_LLM_API_KEY    必填
    GRAD_LLM_BASE_URL   默认 https://api.openai.com/v1（兼容任意 OpenAI 风格接口）
    GRAD_LLM_MODEL      默认 gpt-4o-mini
"""

import itertools
import json
import os
import time
from typing import Optional

from pydantic import ValidationError

from parsers.base import ParsedDocument
from schemas import ExtractionResult

PROMPT = """You are an expert academic-regulations parser for HKUST (Hong Kong University of Science and Technology) program requirement PDFs.

Below is the full text of ONE program requirement PDF. Pages are marked with `===== [PAGE n] =====`.

Extract the complete graduation requirement tree as strict JSON matching this schema:
{
  "year": string,                       # the admission cohort, e.g. "2026-27"
  "code": string,                       # the major code, e.g. "COMP"
  "title": string,                      # program title, e.g. "BEng in Computer Science"
  "total_required_credits": number,     # total credits required for the major, 0 if not stated
  "groups": [
    {
      "name": string,                   # requirement group heading, e.g. "Required Courses"
      "required_credits": number,       # credits required for this group (from "Credit(s) attained" column), lower bound if a range
      "required_credits_raw": string,   # the raw text of the requirement, e.g. "12" or "12-18"
      "note": string,                   # the raw "Note:" text if the group has OR/AND combination rules, else ""
      "courses": [
        {
          "code": string,               # e.g. "COMP1023" (join "COMP" + "1023", NO space, UPPERCASE)
          "name": string,
          "credits": number,            # lower bound if range like 4-6 -> 4
          "credits_raw": string,        # raw credits text
          "areas": [string],            # for ELECTIVE lists: area heading(s) this course belongs to, e.g. ["Artificial Intelligence"]. Empty for non-elective courses
          "source_pages": [int]         # 1-based page numbers where this course appears
        }
      ],
      "source_pages": [int]
    }
  ],
  "uncertain": [string]                 # items you are unsure about; describe what needs human review
}

Rules:
1. Course code normalization: PDF splits codes across lines like "COMP" / "1023" -> "COMP1023".
2. Keep the original group order as it appears in the PDF.
3. Groups in these PDFs usually have a header row "Credit(s) attained" — the number in that column is required_credits.
4. A single course row may have a Note like "MATH 1013 OR MATH 1024" — attach the Note to the group `note` field, and list each mentioned course as a course entry too.
5. Do NOT invent courses. Every course must appear in the text. Quote credits exactly (lower bound for ranges).
6. Every course/group MUST carry source_pages referencing the page markers above.
7. AREA extraction (elective lists): inside an elective group the PDF subdivides courses under area headings like
   "Artificial Intelligence Area", "Vision & Graphics / Multimedia Area", "Software / Database Area",
   "Computer Systems / Networking Area", "Theory Area", "Courses Without Associated Area".
   - The area heading text (WITHOUT the trailing word "Area") goes into the `areas` array of EVERY course listed under it.
   - The same course may appear under MULTIPLE areas — include ALL of them in its `areas` array.
   - Courses under "Courses Without Associated Area" get an EMPTY `areas` array.
   - Non-elective courses (required groups) also get an EMPTY `areas` array.
8. Group `note`: preserve the FULL original note text verbatim, including long bracketed explanations
   (e.g. "(5 courses from the specified elective list, of which at least 3 courses should be taken from 1 area ...)")
   and any special clauses (e.g. "Students may use at most one course under Deep Learning Applications ...").
9. Output ONLY the JSON object, no markdown fences, no commentary."""


def _client():
    from openai import OpenAI

    api_key = os.environ.get("GRAD_LLM_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "缺少 GRAD_LLM_API_KEY 环境变量。请配置 LLM API key 后重跑，"
            "或使用 --skip-llm 只执行解析与 crosscheck 步骤。"
        )
    return OpenAI(
        api_key=api_key,
        base_url=os.environ.get("GRAD_LLM_BASE_URL", "https://api.openai.com/v1"),
    )


_model_cycle = itertools.count()


def _available_models() -> list[str]:
    """模型池：GRAD_LLM_MODELS（逗号分隔）优先，回退 GRAD_LLM_MODEL 单模型。

    网关限流按模型独立计数，轮换多模型可成倍提升批量吞吐。
    """
    raw = os.environ.get("GRAD_LLM_MODELS", "") or os.environ.get("GRAD_LLM_MODEL", "gpt-4o-mini")
    return [m.strip() for m in raw.split(",") if m.strip()]


def _next_model() -> str:
    models = _available_models()
    return models[next(_model_cycle) % len(models)]


def get_client():
    """公开入口：构造 OpenAI 兼容客户端（缺 GRAD_LLM_API_KEY 时抛 RuntimeError）。"""
    return _client()


def next_model() -> str:
    """公开入口：轮换模型池中的下一个模型。

    与 llm_extract 共用同一个轮换计数器——第二 pass（extract_b）也走这里，
    两 pass 交替消耗模型池，避免同一个模型被连续打满限流。
    """
    return _next_model()


def extract_requirements(doc: ParsedDocument, year: str, code: str) -> ExtractionResult:
    """调用 LLM 抽取毕业要求树；429 时轮换模型池中的下一个模型，Schema 校验失败自动修复重试。"""
    client = _client()
    user_payload = (
        f"Known from file index — year: {year}, major code: {code}, "
        f"source file: {doc.source_path}\n\n{doc.text_with_page_markers()}"
    )

    last_err: Optional[str] = None
    for attempt in range(2):
        repair = ""
        if last_err:
            repair = (
                f"\n\nYour previous output failed schema validation:\n{last_err}\n"
                "Fix the issues and return the corrected JSON only."
            )
        # 429 时轮换模型池中的下一个模型（网关限流按模型独立计数）；
        # 免费网关冷却可能持续数分钟，30 轮轮换 + 10s 退避 ≈ 5 分钟耐心
        resp = None
        for retry in range(30):
            model = _next_model()
            try:
                resp = client.chat.completions.create(
                    model=model,
                    temperature=0,
                    response_format={"type": "json_object"},
                    # 禁用深度思考：各家写法不同，全部带上（网关透传或忽略）
                    # GLM: thinking.type=disabled；Qwen/vLLM: chat_template_kwargs.enable_thinking=false
                    extra_body={
                        "thinking": {"type": "disabled"},
                        "chat_template_kwargs": {"enable_thinking": False},
                        "reasoning_effort": "none",
                    },
                    timeout=300.0,
                    messages=[
                        {"role": "system", "content": PROMPT},
                        {"role": "user", "content": user_payload + repair},
                    ],
                )
                print(f"[llm_extract] OK via {model}")
                break
            except Exception as exc:  # noqa: BLE001 — 限流/网络错误统一处理
                if retry == 29:
                    raise
                is_rate = "429" in str(exc) or "rate" in str(exc).lower()
                wait = 10.0 if is_rate else 20.0
                print(f"[llm_extract] {model} failed ({str(exc)[:80]}), retry in {wait:.0f}s", flush=True)
                time.sleep(wait)
        raw = resp.choices[0].message.content or "{}"  # type: ignore[union-attr]
        try:
            return ExtractionResult.model_validate(json.loads(raw))
        except (json.JSONDecodeError, ValidationError) as exc:
            last_err = str(exc)[:1500]
            print(f"[llm_extract] attempt {attempt + 1} schema failed: {last_err[:200]}")

    raise RuntimeError(f"LLM 抽取连续两次未通过 Schema 校验: {code} {year}")
