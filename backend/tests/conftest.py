"""pytest 配置：必须在导入 app 之前把 DB 指向临时副本，避免污染真实数据。"""

import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

_TMP_DIR = Path(tempfile.mkdtemp(prefix="grad_test_"))
os.environ["GRAD_DB_PATH"] = str(_TMP_DIR / "test_grad.db")
os.environ["GRAD_SOURCE_DB_PATH"] = str(PROJECT_ROOT / "courses.db")
