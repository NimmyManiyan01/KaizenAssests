"""Allow physical dock deletion while retaining historical dock codes."""

from alembic import op
import sqlalchemy as sa


revision = "20261106_hard_delete_docks"
down_revision = "20261106_assembly_lifecycle_unit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "dock_assignment" not in inspector.get_table_names():
        return
    foreign_keys = inspector.get_foreign_keys("dock_assignment")
    constraint = next(
        (
            fk
            for fk in foreign_keys
            if fk.get("constrained_columns") == ["dock_number"]
            and fk.get("referred_table") == "warehouse_dock"
        ),
        None,
    )
    if constraint and constraint.get("name"):
        op.drop_constraint(constraint["name"], "dock_assignment", type_="foreignkey")


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "dock_assignment" not in inspector.get_table_names():
        return
    exists = any(
        fk.get("constrained_columns") == ["dock_number"]
        and fk.get("referred_table") == "warehouse_dock"
        for fk in inspector.get_foreign_keys("dock_assignment")
    )
    if not exists:
        # Historical assignments may refer to deleted docks. Keep those rows
        # while restoring the constraint for future writes.
        op.execute(
            "ALTER TABLE dock_assignment ADD CONSTRAINT "
            "fk_dock_assignment_dock_number_warehouse_dock "
            "FOREIGN KEY (dock_number) REFERENCES warehouse_dock (dock_number) "
            "ON DELETE RESTRICT NOT VALID"
        )
