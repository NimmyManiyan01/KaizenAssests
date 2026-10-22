"""Self-contained tests on temporary databases; run via unittest."""
import importlib.util
from pathlib import Path
import sqlite3
from contextlib import closing
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("repair_grn", Path(__file__).resolve().parents[2] / "scripts/repair_grn_sqlite_nullable_po.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GrnSchemaRepairTests(unittest.TestCase):
    def test_repair_preserves_records_relations_indexes_and_triggers(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.db"
            with closing(sqlite3.connect(path)) as db:
                db.executescript("""
                    PRAGMA foreign_keys=ON;
                    CREATE TABLE grn (id TEXT PRIMARY KEY, po_id TEXT NOT NULL, po_number TEXT, grn_number TEXT UNIQUE, status TEXT NOT NULL);
                    CREATE INDEX ix_grn_po_id ON grn(po_id);
                    CREATE TABLE grn_line (id TEXT PRIMARY KEY, grn_id TEXT REFERENCES grn(id));
                    CREATE TABLE audit (grn_id TEXT);
                    CREATE TRIGGER grn_audit AFTER INSERT ON grn BEGIN INSERT INTO audit VALUES (NEW.id); END;
                    INSERT INTO grn VALUES ('old', 'po-1', 'PO-1', 'GRN-1', 'DRAFT');
                    INSERT INTO grn_line VALUES ('line-1', 'old');
                """)
            self.assertFalse(module.repair(path)["changed"])
            result = module.repair(path, apply=True)
            self.assertTrue(result["changed"])
            self.assertTrue(Path(result["backup"]).exists())
            with closing(sqlite3.connect(path)) as db:
                db.execute("PRAGMA foreign_keys=ON")
                self.assertEqual(db.execute("SELECT * FROM grn WHERE id='old'").fetchone(), ('old','po-1','PO-1','GRN-1','DRAFT'))
                self.assertEqual(db.execute('SELECT * FROM grn_line').fetchall(), [('line-1','old')])
                db.execute("INSERT INTO grn VALUES ('new', NULL, NULL, 'GRN-2', 'DRAFT')")
                self.assertEqual(db.execute("SELECT count(*) FROM audit").fetchone()[0], 2)
                self.assertTrue(db.execute("SELECT name FROM sqlite_master WHERE name='ix_grn_po_id'").fetchone())
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute("INSERT INTO grn VALUES ('bad', NULL, NULL, 'GRN-2', 'DRAFT')")
            self.assertFalse(module.repair(path, apply=True)["changed"])

    def test_missing_database_is_not_created(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "missing.db"
            with self.assertRaises(FileNotFoundError):
                module.repair(path, apply=True)
            self.assertFalse(path.exists())
