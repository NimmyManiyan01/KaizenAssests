from decimal import Decimal


def remaining_shortage(required: Decimal, received: Decimal) -> Decimal:
    return max(Decimal("0"), required - received)


def test_fully_received_material_has_no_shortage():
    assert remaining_shortage(Decimal("100"), Decimal("100")) == Decimal("0")


def test_partially_received_material_keeps_only_outstanding_shortage():
    assert remaining_shortage(Decimal("100"), Decimal("60")) == Decimal("40")


def test_unreceived_material_has_full_shortage():
    assert remaining_shortage(Decimal("100"), Decimal("0")) == Decimal("100")
