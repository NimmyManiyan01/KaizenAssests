from datetime import datetime, timezone
from sqlalchemy import Column, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import relationship
from app.database.base import Base, GUID


class CustomerOrderCustomerModel(Base):
    __tablename__ = "customer_order_customer"
    id = Column(GUID, primary_key=True)
    name = Column(String(255), nullable=False, unique=True, index=True)
    address = Column(Text, nullable=True)
    contact_person = Column(String(128), nullable=True)
    phone = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class CustomerOrderModel(Base):
    __tablename__ = "customer_order"
    id = Column(GUID, primary_key=True)
    order_number = Column(String(64), nullable=False, unique=True, index=True)
    customer_id = Column(GUID, ForeignKey("customer_order_customer.id"), nullable=False)
    customer_po = Column(String(128), nullable=True)
    order_date = Column(Date, nullable=False)
    expected_delivery_date = Column(Date, nullable=False)
    status = Column(String(32), nullable=False, default="DRAFT", index=True)
    remarks = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    customer = relationship("CustomerOrderCustomerModel")
    items = relationship("CustomerOrderItemModel", cascade="all, delete-orphan", back_populates="order")


class CustomerOrderItemModel(Base):
    __tablename__ = "customer_order_item"
    id = Column(GUID, primary_key=True)
    order_id = Column(GUID, ForeignKey("customer_order.id", ondelete="CASCADE"), nullable=False)
    product_code = Column(String(64), nullable=False, index=True)
    product_name = Column(String(255), nullable=False)
    ordered_quantity = Column(Numeric(18, 4), nullable=False)
    dispatched_quantity = Column(Numeric(18, 4), nullable=False, default=0)
    uom = Column(String(32), nullable=False, default="PCS")
    order = relationship("CustomerOrderModel", back_populates="items")
