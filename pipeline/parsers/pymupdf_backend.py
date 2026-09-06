"""pymupdf 轻量降级后端：纯本地、零依赖外部服务。

适用：文字版 PDF（HKUST 官方文档为网页导出电子版，通常可直读）。
表格用 page.find_tables() 还原行结构；扫描页自动标记为空并告警。
"""

import pymupdf

from .base import PageBlock, ParsedDocument


def parse_pdf(pdf_path: str) -> ParsedDocument:
    doc = pymupdf.open(pdf_path)
    pages: dict[int, str] = {}
    blocks: list[PageBlock] = []
    empty_pages: list[int] = []

    for idx, page in enumerate(doc):
        page_no = idx + 1
        text = page.get_text().strip()
        pages[page_no] = text

        # 表格还原
        try:
            tables = page.find_tables().tables
        except Exception as exc:  # noqa: BLE001 — 表格提取失败不影响整体
            print(f"[pymupdf] page {page_no}: find_tables failed: {exc}")
            tables = []
        for t_idx, table in enumerate(tables):
            rows = [[(cell or "").strip() for cell in row] for row in table.extract]
            rows_text = "\n".join(" | ".join(r) for r in rows)
            blocks.append(
                PageBlock(
                    page=page_no,
                    type="table",
                    text=rows_text,
                    table_rows=rows,
                )
            )

        if text:
            blocks.append(PageBlock(page=page_no, type="text", text=text))
        else:
            empty_pages.append(page_no)

    markdown = "\n\n".join(
        f"<!-- page {p} -->\n{pages[p]}" for p in sorted(pages) if pages[p]
    )

    if empty_pages:
        print(f"[pymupdf] WARNING: {len(empty_pages)} empty page(s) {empty_pages[:10]} — 可能是扫描页，建议改用 mineru_api 后端")

    doc.close()
    return ParsedDocument(
        source_path=pdf_path,
        parser_name="pymupdf",
        pages=pages,
        blocks=blocks,
        markdown=markdown,
    )
