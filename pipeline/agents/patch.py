"""把仲裁结论（final_patch）应用到抽取结果上。

final_patch 的键是不可信输入（来自第二 pass 或 LLM judge 的路径字符串），
因此这里做三重收敛：
1. 路径必须符合 `groups[i][.courses[j]].field` 形状；
2. 下标不得越界；
3. 字段名必须是模型已声明的字段（防止写入任意属性）。

任一条不满足就记入 skipped 并跳过——宁可少改一处，也不写脏数据。
"""

from __future__ import annotations

import re

from schemas import ExtractionResult

_PATH_RE = re.compile(r"^groups\[(\d+)\](?:\.courses\[(\d+)\])?\.(\w+)$")


def apply_patch(
    result: ExtractionResult, patch: dict
) -> tuple[ExtractionResult, list[str], list[str]]:
    """返回 (结果, 已应用的路径, 被跳过的路径)。"""
    applied: list[str] = []
    skipped: list[str] = []

    for path, value in patch.items():
        match = _PATH_RE.match(path)
        if match is None:
            skipped.append(path)
            continue

        gi, course_index, field = match.groups()
        group_index = int(gi)
        if group_index >= len(result.groups):
            skipped.append(path)
            continue

        group = result.groups[group_index]
        if course_index is None:
            target, allowed = group, type(group).model_fields
        else:
            ci = int(course_index)
            if ci >= len(group.courses):
                skipped.append(path)
                continue
            target, allowed = group.courses[ci], type(group.courses[ci]).model_fields

        if field not in allowed:
            skipped.append(path)
            continue

        setattr(target, field, value)
        applied.append(path)

    return result, applied, skipped
