"""Run Phase 4 regressions exclusively against the existing disposable database.

Run from backend/business-service with its virtual environment interpreter.
"""
import os
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit

from dotenv import dotenv_values

parts = urlsplit(dotenv_values(".env").get("DATABASE_URL", ""))
assert parts.scheme in ("postgresql", "postgresql+asyncpg"), "PostgreSQL configuration required"
env = os.environ.copy()
env["KAIZENASSESTS_TEST_DATABASE_URL"] = urlunsplit(
    parts._replace(path="/kaizenassests_test_fg_b978662c")
)
sys.exit(subprocess.call([
    sys.executable, "-m", "pytest",
    "tests/integration/test_fg_consumption_traceability.py",
    "tests/unit/test_assembly_qc_authorization.py",
    "tests/unit/test_assembly_completion_date.py",
    "tests/unit/test_assembly_status_consistency.py",
    "-q", "-p", "no:cacheprovider",
], env=env))
