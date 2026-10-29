"""Add append-only, batch-linked assembly consumption events."""

from alembic import op
import sqlalchemy as sa


revision = "20261029_fg_consumption_traceability"
down_revision = "20261028_multiple_pickup_gate_visits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError(
            "Finished-goods consumption integrity triggers require PostgreSQL"
        )

    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    table_exists = "assembly_material_consumption_event" in tables
    if table_exists:
        columns = {
            column["name"]
            for column in inspector.get_columns("assembly_material_consumption_event")
        }
        required_columns = {
            "id",
            "assembly_order_id",
            "material_code",
            "grn_batch_id",
            "grn_batch_qr_id",
            "material_qr",
            "idempotency_key",
            "actual_consumed",
            "uom",
            "consumed_at",
            "recorded_by",
        }
        if not required_columns.issubset(columns):
            raise RuntimeError(
                "assembly_material_consumption_event already exists with an incompatible schema"
            )
    else:
        op.create_table(
            "assembly_material_consumption_event",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("assembly_order_id", sa.Uuid(), nullable=False),
            sa.Column("material_code", sa.String(length=64), nullable=False),
            sa.Column("grn_batch_id", sa.Uuid(), nullable=False),
            sa.Column("grn_batch_qr_id", sa.Uuid(), nullable=True),
            sa.Column("material_qr", sa.String(length=128), nullable=True),
            sa.Column("idempotency_key", sa.String(length=128), nullable=False),
            sa.Column("actual_consumed", sa.Numeric(18, 4), nullable=False),
            sa.Column("uom", sa.String(length=32), nullable=False),
            sa.Column("consumed_at", sa.DateTime(), nullable=False),
            sa.Column("recorded_by", sa.String(length=128), nullable=False),
            sa.CheckConstraint(
                "actual_consumed > 0",
                name="ck_assembly_consumption_event_positive_qty",
            ),
            sa.CheckConstraint(
                "length(trim(idempotency_key)) > 0",
                name="ck_assembly_consumption_event_idempotency_key",
            ),
            sa.CheckConstraint(
                "(material_qr IS NULL AND grn_batch_qr_id IS NULL) OR "
                "(material_qr IS NOT NULL AND grn_batch_qr_id IS NOT NULL)",
                name="ck_assembly_consumption_event_qr_pair",
            ),
            sa.ForeignKeyConstraint(
                ["assembly_order_id"], ["assembly_order.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["grn_batch_id"], ["grn_batch.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["grn_batch_qr_id"], ["grn_batch_qr.id"], ondelete="RESTRICT"
            ),
            sa.UniqueConstraint(
                "idempotency_key",
                name="uq_assembly_consumption_event_idempotency",
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = sa.inspect(op.get_bind())
    constraints = inspector.get_unique_constraints("assembly_material_consumption_event")
    idempotency_constraint = any(
        constraint.get("name") == "uq_assembly_consumption_event_idempotency"
        and constraint.get("column_names") == ["idempotency_key"]
        for constraint in constraints
    )
    unexpected_unique_constraints = [
        constraint for constraint in constraints
        if constraint.get("column_names") != ["idempotency_key"]
    ]
    if unexpected_unique_constraints or not idempotency_constraint:
        raise RuntimeError(
            "assembly_material_consumption_event must have idempotency uniqueness only; "
            "material and batch events must remain repeatable"
        )
    foreign_keys = inspector.get_foreign_keys("assembly_material_consumption_event")
    required_foreign_keys = {
        ("assembly_order_id", "assembly_order"),
        ("grn_batch_id", "grn_batch"),
    }
    actual_foreign_keys = {
        (fk.get("constrained_columns", [None])[0], fk.get("referred_table"))
        for fk in foreign_keys
        if len(fk.get("constrained_columns") or []) == 1
    }
    if not required_foreign_keys.issubset(actual_foreign_keys):
        raise RuntimeError(
            "assembly_material_consumption_event is missing its order or GRN batch foreign key"
        )
    if not any(
        fk.get("constrained_columns") == ["grn_batch_qr_id"]
        and fk.get("referred_table") == "grn_batch_qr"
        for fk in foreign_keys
    ):
        raise RuntimeError(
            "assembly_material_consumption_event is missing its optional GRN batch QR reference"
        )

    indexes = {index.get("name") for index in inspector.get_indexes("assembly_material_consumption_event")}
    for name, column in (
        ("ix_assembly_material_consumption_event_order", "assembly_order_id"),
        ("ix_assembly_material_consumption_event_material", "material_code"),
        ("ix_assembly_material_consumption_event_batch", "grn_batch_id"),
        ("ix_assembly_material_consumption_event_batch_qr", "grn_batch_qr_id"),
    ):
        if name not in indexes:
            op.create_index(name, "assembly_material_consumption_event", [column])
    if "ix_assembly_material_consumption_event_order_time" not in indexes:
        op.create_index(
            "ix_assembly_material_consumption_event_order_time",
            "assembly_material_consumption_event",
            ["assembly_order_id", "consumed_at"],
        )

    op.execute("DROP VIEW IF EXISTS assembly_material_consumption_traceability")
    op.execute("""
        CREATE VIEW assembly_material_consumption_traceability AS
        SELECT
            'AGGREGATE' AS record_type,
            c.id AS consumption_id,
            c.assembly_order_id,
            c.material_code,
            NULL AS grn_batch_id,
            NULL AS grn_batch_qr_id,
            NULL AS material_qr,
            c.actual_consumed,
            c.uom,
            c.recorded_at AS consumed_at,
            c.recorded_by,
            'UNLINKED' AS traceability_status
        FROM assembly_material_consumption c
        UNION ALL
        SELECT
            'EVENT' AS record_type,
            e.id AS consumption_id,
            e.assembly_order_id,
            e.material_code,
            e.grn_batch_id,
            e.grn_batch_qr_id,
            e.material_qr,
            e.actual_consumed,
            e.uom,
            e.consumed_at,
            e.recorded_by,
            CASE
                WHEN e.material_qr IS NOT NULL AND EXISTS (
                    SELECT 1
                    FROM grn_batch_qr q
                    WHERE q.id = e.grn_batch_qr_id
                      AND q.batch_id = e.grn_batch_id
                      AND q.qr_code = e.material_qr
                      AND upper(trim(q.item_code)) = upper(trim(e.material_code))
                ) THEN 'VERIFIED'
                ELSE 'INCOMPLETE'
            END AS traceability_status
        FROM assembly_material_consumption_event e
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION validate_assembly_material_consumption_event()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        DECLARE
            v_batch_number varchar(128);
            v_batch_material_code varchar(64);
            v_qr_id uuid;
            v_pick_task_id uuid;
            v_task_number varchar(64);
            v_material_issue_id uuid;
            v_issue_number varchar(64);
            v_issued_quantity numeric(18, 4);
            v_returned_quantity numeric(18, 4);
            v_unbatched_return_count bigint;
            v_consumed_quantity numeric(18, 4);
        BEGIN
            IF length(trim(NEW.idempotency_key)) = 0 THEN
                RAISE EXCEPTION 'An idempotency key is required for a consumption event'
                    USING ERRCODE = '23514';
            END IF;
            IF EXISTS (
                SELECT 1 FROM assembly_material_consumption_event e
                WHERE e.idempotency_key = NEW.idempotency_key
            ) THEN
                RAISE EXCEPTION 'This consumption transaction has already been recorded'
                    USING ERRCODE = '23505';
            END IF;

            SELECT ao.pick_task_id, ao.material_issue_id
              INTO v_pick_task_id, v_material_issue_id
              FROM assembly_order ao
             WHERE ao.id = NEW.assembly_order_id
             FOR UPDATE;
            IF NOT FOUND OR v_pick_task_id IS NULL OR v_material_issue_id IS NULL THEN
                RAISE EXCEPTION 'Consumption requires an assembly order with linked warehouse pick and issue records'
                    USING ERRCODE = '23514';
            END IF;
            SELECT p.task_number
              INTO v_task_number
              FROM pick_task p
             WHERE p.id = v_pick_task_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'The assembly order pick task does not exist'
                    USING ERRCODE = '23503';
            END IF;
            IF v_material_issue_id IS NOT NULL THEN
                SELECT mi.issue_number INTO v_issue_number
                  FROM material_issue mi
                 WHERE mi.id = v_material_issue_id;
            END IF;
            IF v_issue_number IS NULL THEN
                RAISE EXCEPTION 'The assembly order issue number is required to reconcile material returns'
                    USING ERRCODE = '23514';
            END IF;

            SELECT b.batch_number, gl.item_code
              INTO v_batch_number, v_batch_material_code
              FROM grn_batch b
              JOIN grn_line gl ON gl.id = b.grn_line_id
             WHERE b.id = NEW.grn_batch_id
             FOR SHARE OF b, gl;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'The referenced GRN batch does not exist'
                    USING ERRCODE = '23503';
            END IF;
            IF upper(trim(v_batch_material_code)) <> upper(trim(NEW.material_code)) THEN
                RAISE EXCEPTION 'GRN batch material % does not match consumption material %',
                    v_batch_material_code, NEW.material_code
                    USING ERRCODE = '23514';
            END IF;

            IF (NEW.grn_batch_qr_id IS NULL) <> (NEW.material_qr IS NULL) THEN
                RAISE EXCEPTION 'Provide both the scanned QR identity and its saved QR record, or neither'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.grn_batch_qr_id IS NOT NULL THEN
                SELECT q.id INTO v_qr_id
                  FROM grn_batch_qr q
                 WHERE q.id = NEW.grn_batch_qr_id
                   AND q.batch_id = NEW.grn_batch_id
                   AND upper(trim(q.item_code)) = upper(trim(NEW.material_code))
                   AND q.qr_code = NEW.material_qr
                 FOR SHARE OF q;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'The saved material QR does not match the referenced GRN batch and material'
                        USING ERRCODE = '23514';
                END IF;
            END IF;

            PERFORM 1
              FROM inventory_movement_history m
             WHERE upper(m.movement_type) = 'TAKEAWAY'
               AND upper(trim(m.to_location)) = 'ASSEMBLY'
               AND upper(trim(m.material_code)) = upper(trim(NEW.material_code))
               AND m.batch_lot = v_batch_number
               AND m.reference_document = v_task_number
             FOR SHARE;

            SELECT coalesce(sum(m.quantity), 0)
              INTO v_issued_quantity
              FROM inventory_movement_history m
             WHERE upper(m.movement_type) = 'TAKEAWAY'
               AND upper(trim(m.to_location)) = 'ASSEMBLY'
               AND upper(trim(m.material_code)) = upper(trim(NEW.material_code))
               AND m.batch_lot = v_batch_number
               AND m.reference_document = v_task_number;
            IF v_issued_quantity <= 0 THEN
                RAISE EXCEPTION 'No verified batch-specific warehouse issue exists for this order and material'
                    USING ERRCODE = '23514';
            END IF;

            v_returned_quantity := 0;
            v_unbatched_return_count := 0;
            IF v_issue_number IS NOT NULL AND to_regclass('public.material_return') IS NOT NULL THEN
                EXECUTE 'SELECT coalesce(sum(r.returned_quantity), 0) FROM material_return r
                         WHERE r.issue_number = $1 AND upper(trim(r.status)) = ''PROCESSED''
                           AND upper(trim(r.material_code)) = upper(trim($2)) AND r.batch_number = $3'
                   INTO v_returned_quantity USING v_issue_number, NEW.material_code, v_batch_number;
                EXECUTE 'SELECT count(*) FROM material_return r
                         WHERE r.issue_number = $1 AND upper(trim(r.status)) = ''PROCESSED''
                           AND upper(trim(r.material_code)) = upper(trim($2)) AND r.batch_number IS NULL'
                   INTO v_unbatched_return_count USING v_issue_number, NEW.material_code;
                IF v_unbatched_return_count > 0 THEN
                    RAISE EXCEPTION 'A batch-less material return prevents safe per-batch consumption validation'
                        USING ERRCODE = '23514';
                END IF;
            END IF;

            SELECT coalesce(sum(e.actual_consumed), 0)
              INTO v_consumed_quantity
              FROM assembly_material_consumption_event e
             WHERE e.assembly_order_id = NEW.assembly_order_id
               AND upper(trim(e.material_code)) = upper(trim(NEW.material_code))
               AND e.grn_batch_id = NEW.grn_batch_id;
            IF v_consumed_quantity + NEW.actual_consumed > v_issued_quantity - v_returned_quantity THEN
                RAISE EXCEPTION 'Consumption exceeds the verified batch quantity issued to this assembly order'
                    USING ERRCODE = '23514';
            END IF;

            RETURN NEW;
        END;
        $function$
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION reject_assembly_consumption_event_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        BEGIN
            RAISE EXCEPTION 'Consumption events are immutable; record a separate adjustment event'
                USING ERRCODE = '55000';
        END;
        $function$
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION protect_consumed_grn_batch_identity()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        BEGIN
            IF (NEW.grn_line_id IS DISTINCT FROM OLD.grn_line_id
                OR NEW.batch_number IS DISTINCT FROM OLD.batch_number
                OR NEW.batch_quantity IS DISTINCT FROM OLD.batch_quantity)
               AND EXISTS (
                    SELECT 1 FROM assembly_material_consumption_event e
                    WHERE e.grn_batch_id = OLD.id
               ) THEN
                RAISE EXCEPTION 'A GRN batch referenced by manufacturing consumption cannot be changed'
                    USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
        END;
        $function$
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION protect_consumed_grn_batch_qr_identity()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        BEGIN
            IF (NEW.batch_id IS DISTINCT FROM OLD.batch_id
                OR NEW.item_code IS DISTINCT FROM OLD.item_code
                OR NEW.qr_code IS DISTINCT FROM OLD.qr_code
                OR NEW.qr_payload IS DISTINCT FROM OLD.qr_payload)
               AND EXISTS (
                    SELECT 1 FROM assembly_material_consumption_event e
                    WHERE e.grn_batch_qr_id = OLD.id
               ) THEN
                RAISE EXCEPTION 'A GRN material QR referenced by manufacturing consumption cannot be changed'
                    USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
        END;
        $function$
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION protect_consumed_grn_line_identity()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        BEGIN
            IF (NEW.item_code IS DISTINCT FROM OLD.item_code
                OR NEW.grn_id IS DISTINCT FROM OLD.grn_id)
               AND EXISTS (
                    SELECT 1
                      FROM grn_batch b
                      JOIN assembly_material_consumption_event e ON e.grn_batch_id = b.id
                     WHERE b.grn_line_id = OLD.id
               ) THEN
                RAISE EXCEPTION 'A GRN line referenced by manufacturing consumption cannot change material or GRN identity'
                    USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
        END;
        $function$
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION protect_consumption_source_movement()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF EXISTS (
                    SELECT 1
                      FROM assembly_material_consumption_event e
                      JOIN assembly_order ao ON ao.id = e.assembly_order_id
                      JOIN pick_task p ON p.id = ao.pick_task_id
                      JOIN grn_batch b ON b.id = e.grn_batch_id
                     WHERE upper(trim(OLD.movement_type)) = 'TAKEAWAY'
                       AND upper(trim(OLD.to_location)) = 'ASSEMBLY'
                       AND OLD.reference_document = p.task_number
                       AND OLD.batch_lot = b.batch_number
                       AND upper(trim(OLD.material_code)) = upper(trim(e.material_code))
                ) THEN
                    RAISE EXCEPTION 'A warehouse issue movement supporting manufacturing consumption cannot be deleted'
                        USING ERRCODE = '55000';
                END IF;
                RETURN OLD;
            END IF;
            IF EXISTS (
                SELECT 1
                  FROM assembly_material_consumption_event e
                  JOIN assembly_order ao ON ao.id = e.assembly_order_id
                  JOIN pick_task p ON p.id = ao.pick_task_id
                  JOIN grn_batch b ON b.id = e.grn_batch_id
                 WHERE upper(trim(OLD.movement_type)) = 'TAKEAWAY'
                   AND upper(trim(OLD.to_location)) = 'ASSEMBLY'
                   AND OLD.reference_document = p.task_number
                   AND OLD.batch_lot = b.batch_number
                   AND upper(trim(OLD.material_code)) = upper(trim(e.material_code))
                   AND (NEW.movement_type IS DISTINCT FROM OLD.movement_type
                        OR NEW.to_location IS DISTINCT FROM OLD.to_location
                        OR NEW.reference_document IS DISTINCT FROM OLD.reference_document
                        OR NEW.batch_lot IS DISTINCT FROM OLD.batch_lot
                        OR NEW.material_code IS DISTINCT FROM OLD.material_code
                        OR NEW.quantity IS DISTINCT FROM OLD.quantity)
            ) THEN
                RAISE EXCEPTION 'A warehouse issue movement supporting manufacturing consumption cannot be changed or deleted'
                    USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
        END;
        $function$
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION validate_consumption_material_return()
        RETURNS trigger LANGUAGE plpgsql AS $function$
        DECLARE
            v_order_id uuid;
            v_pick_task_id uuid;
            v_task_number varchar(64);
            v_batch_id uuid;
            v_exclude_return_id uuid;
            v_issued_quantity numeric(18, 4);
            v_returned_quantity numeric(18, 4);
            v_consumed_quantity numeric(18, 4);
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;
            IF upper(trim(NEW.status)) <> 'PROCESSED' THEN
                RETURN NEW;
            END IF;
            IF TG_OP = 'UPDATE' THEN
                v_exclude_return_id := OLD.id;
            END IF;

            SELECT ao.id, ao.pick_task_id
              INTO v_order_id, v_pick_task_id
              FROM material_issue mi
              JOIN assembly_order ao ON ao.material_issue_id = mi.id
             WHERE mi.issue_number = NEW.issue_number
             FOR UPDATE OF ao;
            IF NOT FOUND THEN
                RETURN NEW;
            END IF;

            IF NEW.batch_number IS NULL OR length(trim(NEW.batch_number)) = 0 THEN
                IF EXISTS (
                    SELECT 1 FROM assembly_material_consumption_event e
                    WHERE e.assembly_order_id = v_order_id
                      AND upper(trim(e.material_code)) = upper(trim(NEW.material_code))
                ) THEN
                    RAISE EXCEPTION 'A batch-less return cannot be reconciled with batch-tracked consumption'
                        USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END IF;

            SELECT b.id INTO v_batch_id
              FROM grn_batch b
              JOIN grn_line gl ON gl.id = b.grn_line_id
             WHERE b.batch_number = NEW.batch_number
               AND upper(trim(gl.item_code)) = upper(trim(NEW.material_code))
             FOR SHARE OF b, gl;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Returned GRN batch does not match the return material'
                    USING ERRCODE = '23514';
            END IF;

            SELECT p.task_number INTO v_task_number
              FROM pick_task p
             WHERE p.id = v_pick_task_id;
            PERFORM 1
              FROM inventory_movement_history m
             WHERE upper(m.movement_type) = 'TAKEAWAY'
               AND upper(trim(m.to_location)) = 'ASSEMBLY'
               AND upper(trim(m.material_code)) = upper(trim(NEW.material_code))
               AND m.batch_lot = NEW.batch_number
               AND m.reference_document = v_task_number
             FOR SHARE;
            SELECT coalesce(sum(m.quantity), 0)
              INTO v_issued_quantity
              FROM inventory_movement_history m
             WHERE upper(m.movement_type) = 'TAKEAWAY'
               AND upper(trim(m.to_location)) = 'ASSEMBLY'
               AND upper(trim(m.material_code)) = upper(trim(NEW.material_code))
               AND m.batch_lot = NEW.batch_number
               AND m.reference_document = v_task_number;

            IF to_regclass('public.material_return') IS NULL THEN
                RETURN NEW;
            END IF;
            SELECT coalesce(sum(r.returned_quantity), 0)
              INTO v_returned_quantity
              FROM material_return r
             WHERE r.issue_number = NEW.issue_number
               AND upper(trim(r.status)) = 'PROCESSED'
               AND upper(trim(r.material_code)) = upper(trim(NEW.material_code))
               AND r.batch_number = NEW.batch_number
               AND (v_exclude_return_id IS NULL OR r.id <> v_exclude_return_id);
            v_returned_quantity := v_returned_quantity + NEW.returned_quantity;

            SELECT coalesce(sum(e.actual_consumed), 0)
              INTO v_consumed_quantity
              FROM assembly_material_consumption_event e
             WHERE e.assembly_order_id = v_order_id
               AND upper(trim(e.material_code)) = upper(trim(NEW.material_code))
               AND e.grn_batch_id = v_batch_id;
            IF v_returned_quantity > v_issued_quantity
               OR v_consumed_quantity > v_issued_quantity - v_returned_quantity THEN
                RAISE EXCEPTION 'Return would reduce verified available batch material below recorded consumption'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $function$
    """)

    for trigger_name, table_name in (
        ("trg_assembly_consumption_event_validate", "assembly_material_consumption_event"),
        ("trg_assembly_consumption_event_immutable", "assembly_material_consumption_event"),
        ("trg_grn_batch_consumption_identity", "grn_batch"),
        ("trg_grn_batch_qr_consumption_identity", "grn_batch_qr"),
        ("trg_grn_line_consumption_identity", "grn_line"),
        ("trg_consumption_source_movement_immutable", "inventory_movement_history"),
    ):
        op.execute(f'DROP TRIGGER IF EXISTS {trigger_name} ON {table_name}')
    if op.get_bind().execute(sa.text("SELECT to_regclass('public.material_return')")).scalar():
        op.execute("DROP TRIGGER IF EXISTS trg_consumption_event_return_integrity ON material_return")
    op.execute("""
        CREATE TRIGGER trg_assembly_consumption_event_validate
        BEFORE INSERT ON assembly_material_consumption_event
        FOR EACH ROW EXECUTE FUNCTION validate_assembly_material_consumption_event()
    """)
    op.execute("""
        CREATE TRIGGER trg_assembly_consumption_event_immutable
        BEFORE UPDATE OR DELETE ON assembly_material_consumption_event
        FOR EACH ROW EXECUTE FUNCTION reject_assembly_consumption_event_mutation()
    """)
    op.execute("""
        CREATE TRIGGER trg_grn_batch_consumption_identity
        BEFORE UPDATE ON grn_batch
        FOR EACH ROW EXECUTE FUNCTION protect_consumed_grn_batch_identity()
    """)
    op.execute("""
        CREATE TRIGGER trg_grn_batch_qr_consumption_identity
        BEFORE UPDATE ON grn_batch_qr
        FOR EACH ROW EXECUTE FUNCTION protect_consumed_grn_batch_qr_identity()
    """)
    op.execute("""
        CREATE TRIGGER trg_grn_line_consumption_identity
        BEFORE UPDATE ON grn_line
        FOR EACH ROW EXECUTE FUNCTION protect_consumed_grn_line_identity()
    """)
    op.execute("""
        CREATE TRIGGER trg_consumption_source_movement_immutable
        BEFORE UPDATE OR DELETE ON inventory_movement_history
        FOR EACH ROW EXECUTE FUNCTION protect_consumption_source_movement()
    """)
    if op.get_bind().execute(sa.text("SELECT to_regclass('public.material_return')")).scalar():
        op.execute("""
            CREATE TRIGGER trg_consumption_event_return_integrity
            BEFORE INSERT OR UPDATE OR DELETE ON material_return
            FOR EACH ROW EXECUTE FUNCTION validate_consumption_material_return()
        """)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "assembly_material_consumption_event" not in inspector.get_table_names():
        op.execute("DROP VIEW IF EXISTS assembly_material_consumption_traceability")
        return

    event_count = op.get_bind().execute(
        sa.text("SELECT count(*) FROM assembly_material_consumption_event")
    ).scalar_one()
    if event_count:
        raise RuntimeError(
            "Cannot downgrade finished-goods traceability while consumption events exist; "
            "downgrade would delete historical traceability records"
        )
    for trigger_name, table_name in (
        ("trg_assembly_consumption_event_validate", "assembly_material_consumption_event"),
        ("trg_assembly_consumption_event_immutable", "assembly_material_consumption_event"),
        ("trg_grn_batch_consumption_identity", "grn_batch"),
        ("trg_grn_batch_qr_consumption_identity", "grn_batch_qr"),
        ("trg_grn_line_consumption_identity", "grn_line"),
        ("trg_consumption_source_movement_immutable", "inventory_movement_history"),
    ):
        op.execute(f'DROP TRIGGER IF EXISTS {trigger_name} ON {table_name}')
    if op.get_bind().execute(sa.text("SELECT to_regclass('public.material_return')")).scalar():
        op.execute("DROP TRIGGER IF EXISTS trg_consumption_event_return_integrity ON material_return")
    op.execute("DROP VIEW IF EXISTS assembly_material_consumption_traceability")
    op.drop_table("assembly_material_consumption_event")
    for function_name in (
        "validate_assembly_material_consumption_event",
        "reject_assembly_consumption_event_mutation",
        "protect_consumed_grn_batch_identity",
        "protect_consumed_grn_batch_qr_identity",
        "protect_consumed_grn_line_identity",
        "protect_consumption_source_movement",
        "validate_consumption_material_return",
    ):
        op.execute(f"DROP FUNCTION IF EXISTS {function_name}()")
