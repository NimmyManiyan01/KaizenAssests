from __future__ import annotations
from pydantic import BaseModel, Field
from datetime import datetime, date
import uuid

class DispatchItemResponse(BaseModel):
    id: uuid.UUID
    material_code: str
    material_name: str
    quantity_ordered: float
    quantity_available: float
    quantity_reserved: float
    quantity_picked: float
    quantity_packed: float
    quantity_loaded: float
    quantity_pending: float
    uom: str
    batch: str | None = None
    bin: str | None = None
    status: str
    package_number: str | None = None
    package_type: str | None = None
    package_count: int | None = None

    class Config:
        from_attributes = True


class ScanPackageRequest(BaseModel):
    # Assembly finished-goods QR labels can contain the full batch payload,
    # which is longer than a package-number QR.
    qr_code: str = Field(..., min_length=1, max_length=1024)


class ConfirmGateExitRequest(BaseModel):
    gate_pass_id: str = Field(..., min_length=1, max_length=64)
    vehicle_verified: bool
    driver_verified: bool
    loaded_goods_verified: bool
    vehicle_photo_base64: str | None = None
    remarks: str | None = None

class DispatchOrderResponse(BaseModel):
    id: uuid.UUID
    dispatch_number: str
    order_number: str
    customer_name: str
    warehouse_id: str
    assembly_unit_code: str | None = None
    status: str
    items: list[DispatchItemResponse] = Field(default_factory=list)
    loaded_goods: list[dict] = Field(default_factory=list)
    loading_record_reference: str | None = None
    gate_exit_vehicle_verified: bool = False
    gate_exit_driver_verified: bool = False
    gate_exit_loaded_goods_verified: bool = False
    gate_exit_security_officer: str | None = None
    gate_exit_remarks: str | None = None
    gate_exit_completed_at: datetime | None = None
    driver_id: str | None = None
    driver_name: str | None = None
    vehicle_id: str | None = None
    vehicle_number: str | None = None
    route_code: str | None = None
    delivery_address: str | None = None
    destination: str | None = None
    scheduled_date: datetime | None = None
    expected_delivery_date: datetime | None = None
    priority: str = "Normal"
    notes: str | None = None
    current_location: str | None = None
    distance_travelled_km: float = 0
    remaining_distance_km: float = 0
    eta_minutes: float = 0
    route_path: str | None = None
    route_deviation: str | None = None
    driver_status: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DispatchListResponse(BaseModel):
    items: list[DispatchOrderResponse]
    total: int

class DriverResponse(BaseModel):
    id: str
    driver_name: str
    license_number: str
    phone: str
    email: str | None = None
    license_type: str = "Heavy"
    license_expiry_date: date | None = None
    license_verified: bool = False
    is_active: bool = True
    photo_path: str | None = None
    address: str | None = None
    aadhaar_number: str | None = None
    status: str
    rating: float
    assigned_vehicle_id: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class VehicleResponse(BaseModel):
    id: str
    vehicle_number: str
    vehicle_type: str
    ownership_type: str = "Owned"
    capacity_tons: float
    rc_number: str | None = None
    chassis_number: str | None = None
    registration_date: str | None = None
    registration_expiry_date: str | None = None
    insurance_expiry: str | None = None
    fitness_expiry: str | None = None
    permit_expiry: str | None = None
    puc_expiry: str | None = None
    rc_book_number: str | None = None
    puc_valid: bool = True
    insurance_valid: bool = True
    fitness_valid: bool = True
    permit_valid: bool = True
    gps_available: bool = True
    is_active: bool = True
    status: str
    current_driver_id: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
