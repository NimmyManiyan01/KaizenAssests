"""Targeted compatibility for local SQLite databases created before QC auditing."""
from sqlalchemy import inspect


def ensure_local_qc_audit_columns(connection) -> list[str]:
    if connection.dialect.name != "sqlite":
        return []
    inspector = inspect(connection)
    if not inspector.has_table("assembly_quality_inspection"):
        return []
    columns = {column["name"] for column in inspector.get_columns("assembly_quality_inspection")}
    additions = {
        "inspected_by_user_id": "VARCHAR(255)",
        "authorized_person_confirmed": "BOOLEAN NOT NULL DEFAULT 0",
    }
    added = []
    for name, definition in additions.items():
        if name not in columns:
            connection.exec_driver_sql(f"ALTER TABLE assembly_quality_inspection ADD COLUMN {name} {definition}")
            added.append(name)
    return added
