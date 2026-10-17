"""Gate-specific normalization helpers retained by the gate API."""

from __future__ import annotations

import re


def normalize_vehicle_registration(value: str) -> str:
    """Validate and format common Indian vehicle registration numbers."""
    compact = re.sub(r"[^A-Z0-9]", "", str(value).upper())

    bharat = re.fullmatch(r"(\d{2})BH(\d{4})([A-Z]{2})", compact)
    if bharat:
        year, number, series = bharat.groups()
        return f"{year}-BH-{number}-{series}"

    standard = re.fullmatch(r"([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})", compact)
    if standard:
        state, district, series, number = standard.groups()
        return f"{state}-{district.zfill(2)}-{series}-{number}"

    raise ValueError(
        "Vehicle number must match formats such as MH-12-AB-1234 or 22-BH-1234-AA."
    )
