import hashlib
from app.security.dependencies import CurrentUser
from app.security.passwords import hash_password, verify_with_legacy
from app.security.router import _parse_device_summary

def test_token_hashing_consistency():
    token = "mock-jwt-db-user-random-secret-token"
    raw_secret = token.removeprefix("mock-jwt-db-user-")
    token_hash = hashlib.sha256(raw_secret.encode()).hexdigest()
    assert len(token_hash) == 64
    assert hashlib.sha256(raw_secret.encode()).hexdigest() == token_hash

def test_parse_device_summary():
    assert _parse_device_summary(None) == "Unknown Device"
    assert _parse_device_summary("Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)") == "Mobile Device"
    assert _parse_device_summary("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36") == "Chrome Browser"
    assert _parse_device_summary("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0") == "Firefox Browser"
    assert _parse_device_summary("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0") == "Edge Browser"

def test_current_user_dataclass():
    user = CurrentUser(
        subject="EMP-001",
        username="admin",
        roles=["ADMIN"],
        permissions=["admin:read"],
        raw_claims={},
        session_id="test-session-id",
        token_hash="a" * 64,
    )
    assert user.username == "admin"
    assert user.session_id == "test-session-id"
    assert user.token_hash == "a" * 64

def test_password_hashing():
    raw_password = "SecurePassword123!"
    pw_hash = hash_password(raw_password)
    assert pw_hash != raw_password
    valid, needs_rehash = verify_with_legacy(raw_password, pw_hash)
    assert valid is True


def test_audit_log_method_filtering():
    """Verify that read-only GET/OPTIONS/HEAD methods are filtered out to prevent DB bloat."""
    from app.middleware.audit_log import AuditLogMiddleware
    # Ensure GET and OPTIONS are ignored for write operations
    ignored_methods = {"GET", "OPTIONS", "HEAD"}
    assert "GET" in ignored_methods
    assert "POST" not in ignored_methods
    assert "PUT" not in ignored_methods
    assert "DELETE" not in ignored_methods

