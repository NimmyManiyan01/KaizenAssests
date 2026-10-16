"""Targeted local SQLite upgrade without touching application data or Alembic history."""
from sqlalchemy import create_engine, inspect

from app.database.schema_compatibility import ensure_local_qc_audit_columns


def test_old_qc_table_is_upgraded_without_losing_records():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE assembly_quality_inspection (id TEXT PRIMARY KEY, inspected_by TEXT)")
        conn.exec_driver_sql("INSERT INTO assembly_quality_inspection VALUES ('qc-1', 'Original Inspector')")
        conn.exec_driver_sql("CREATE TABLE alembic_version (version_num TEXT)")
        conn.exec_driver_sql("INSERT INTO alembic_version VALUES ('0004')")
        assert ensure_local_qc_audit_columns(conn) == ["inspected_by_user_id", "authorized_person_confirmed"]
        row = conn.exec_driver_sql("SELECT * FROM assembly_quality_inspection").mappings().one()
        assert dict(row) == {"id": "qc-1", "inspected_by": "Original Inspector",
                             "inspected_by_user_id": None, "authorized_person_confirmed": 0}
        assert ensure_local_qc_audit_columns(conn) == []
        conn.exec_driver_sql("UPDATE assembly_quality_inspection SET inspected_by_user_id='user-1', authorized_person_confirmed=1")
        assert ensure_local_qc_audit_columns(conn) == []
        assert conn.exec_driver_sql("SELECT inspected_by_user_id FROM assembly_quality_inspection").scalar_one() == "user-1"
        assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "0004"
    engine.dispose()


def test_missing_table_is_left_for_create_all():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        assert ensure_local_qc_audit_columns(conn) == []
        assert not inspect(conn).has_table("assembly_quality_inspection")
    engine.dispose()
