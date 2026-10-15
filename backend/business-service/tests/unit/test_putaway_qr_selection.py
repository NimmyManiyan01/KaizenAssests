"""Regression contract for batch-specific putaway QR selection."""

from pathlib import Path


def test_putaway_enrichment_prefers_canonical_batch_qr_before_handling_unit_qr():
    source = Path("app/modules/storage/infrastructure/api/router.py").read_text(encoding="utf-8")
    batch_lookup = source.index("select(GrnBatchModel.id)")
    handling_unit_fallback = source.index("hu.barcode_value if hu and hu.barcode_value")

    assert batch_lookup < handling_unit_fallback
    assert "GrnBatchModel.batch_number" in source[batch_lookup:handling_unit_fallback]
    assert "GrnBatchQrModel.batch_id == batch_id" in source[batch_lookup:handling_unit_fallback]
