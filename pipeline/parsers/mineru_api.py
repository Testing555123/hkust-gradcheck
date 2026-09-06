"""MinerU 官方在线 API 后端（默认推荐）。

真实端点（依据官方 mineru-open-sdk 源码核对）：
    1. POST {base}/file-urls/batch        申请预签名上传链接，返回 batch_id + file_urls
    2. PUT  file 到预签名 URL              （无需认证头）
    3. GET  {base}/extract-results/batch/{batch_id}   轮询任务状态
    4. 下载 full_zip_url → zip 内含 full.md 与 *_content_list.json（page_idx 带页码）

环境变量：
    MINERU_API_TOKEN   官方 API Token（https://mineru.net → API 管理）
    MINERU_API_BASE    默认 https://mineru.net/api/v4
"""

import io
import json
import os
import time
import zipfile
from pathlib import Path

import httpx

from .base import PageBlock, ParsedDocument

POLL_INTERVAL = 3.0
POLL_TIMEOUT = 600.0


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _submit(client: httpx.Client, base: str, token: str, pdf_path: Path) -> tuple[str, str]:
    """申请上传链接并上传文件，返回 batch_id。"""
    payload = {
        "enable_table": True,
        "files": [{"name": pdf_path.name, "is_ocr": True}],
    }
    resp = client.post(f"{base}/file-urls/batch", headers=_headers(token), json=payload, timeout=60.0)
    resp.raise_for_status()
    body = resp.json()
    if body.get("code") not in (0, None):
        raise RuntimeError(f"MinerU 申请上传链接失败: {json.dumps(body, ensure_ascii=False)[:300]}")
    data = body["data"]
    batch_id: str = data["batch_id"]
    upload_url: str = data["file_urls"][0]

    put = httpx.put(upload_url, content=pdf_path.read_bytes(), timeout=httpx.Timeout(60, write=300))
    put.raise_for_status()
    print(f"[mineru_api] uploaded {pdf_path.name} (batch={batch_id})")
    return batch_id, upload_url


def _poll(client: httpx.Client, base: str, token: str, batch_id: str) -> str:
    """轮询批次结果直到完成，返回 full_zip_url。"""
    deadline = time.time() + POLL_TIMEOUT
    while time.time() < deadline:
        resp = client.get(
            f"{base}/extract-results/batch/{batch_id}", headers=_headers(token), timeout=60.0
        )
        resp.raise_for_status()
        body = resp.json()
        items = (body.get("data") or {}).get("extract_result") or []
        if items:
            item = items[0]
            state = item.get("state")
            if state == "done":
                url = item.get("full_zip_url")
                if not url:
                    raise RuntimeError(f"任务完成但无 full_zip_url: {json.dumps(item)[:300]}")
                return url
            if state == "failed":
                raise RuntimeError(f"MinerU 任务失败: {item.get('err_msg', json.dumps(item)[:200])}")
            print(f"[mineru_api] state={state}")
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f"MinerU 任务超时（{POLL_TIMEOUT}s）: {batch_id}")


def _download_and_parse(client: httpx.Client, zip_url: str, pdf_path: str) -> ParsedDocument:
    resp = client.get(zip_url, timeout=180.0)
    resp.raise_for_status()
    zf = zipfile.ZipFile(io.BytesIO(resp.content))

    md_name = next((n for n in zf.namelist() if n.endswith(".md")), None)
    cl_name = next((n for n in zf.namelist() if n.endswith("_content_list.json")), None)

    markdown = zf.read(md_name).decode("utf-8") if md_name else ""
    content_list = json.loads(zf.read(cl_name).decode("utf-8")) if cl_name else []

    pages: dict[int, str] = {}
    blocks: list[PageBlock] = []
    for item in content_list:
        page_no = int(item.get("page_idx", 0)) + 1  # 0-based -> 1-based
        item_type = item.get("type", "text")
        text = item.get("text") or ""
        table_rows: list[list[str]] = []
        if item_type == "table":
            body = (item.get("table_body") or "").strip()
            if body:
                rows = [
                    [c.strip() for c in row.strip(" |").split("|")]
                    for row in body.splitlines()
                    if row.strip() and set(row.strip()) - {"|", "-", " "}
                ]
                table_rows = rows
                text = "\n".join(" | ".join(r) for r in rows)
        if item_type == "image" and not text:
            text = item.get("img_caption") or ""
        if not text:
            continue
        pages[page_no] = (pages.get(page_no, "") + "\n" + text).strip()
        blocks.append(PageBlock(page=page_no, type=item_type, text=text, table_rows=table_rows))

    return ParsedDocument(
        source_path=pdf_path,
        parser_name="mineru_api",
        pages=pages,
        blocks=blocks,
        markdown=markdown,
    )


def parse_pdf(pdf_path: str, *, token: str | None = None, base: str | None = None) -> ParsedDocument:
    token = token or os.environ.get("MINERU_API_TOKEN", "")
    base = base or os.environ.get("MINERU_API_BASE", "https://mineru.net/api/v4")
    if not token:
        raise RuntimeError(
            "缺少 MINERU_API_TOKEN。请到 https://mineru.net 获取后在环境变量配置，"
            "或改用 --parser pymupdf 降级后端。"
        )
    pdf = Path(pdf_path)
    with httpx.Client() as client:
        batch_id, _ = _submit(client, base, token, pdf)
        zip_url = _poll(client, base, token, batch_id)
        return _download_and_parse(client, zip_url, str(pdf))
