"""
Azure Application Insights & OpenTelemetry distributed tracing and metrics setup (CHG-AZ-004).
Provides centralized tracing, request correlation, query duration telemetry,
and real-time Azure Monitor alerting integration for Microsoft Azure deployment.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import FastAPI
from app.config.settings import get_settings

logger = logging.getLogger(__name__)

_telemetry_initialized: bool = False
_telemetry_backend: str = "none"


def is_telemetry_initialized() -> bool:
    """Return whether telemetry exporter has been initialized."""
    return _telemetry_initialized


def get_telemetry_backend() -> str:
    """Return active telemetry backend ('azure-monitor', 'opentelemetry-sdk', or 'none')."""
    return _telemetry_backend


def setup_telemetry(app: Optional[FastAPI] = None) -> bool:
    """
    Initialize OpenTelemetry and/or Azure Application Insights.
    Gracefully skips or falls back if dependencies are not available or if disabled.
    """
    global _telemetry_initialized, _telemetry_backend
    if _telemetry_initialized:
        return True

    settings = get_settings()

    # 1. Azure Application Insights via azure-monitor-opentelemetry (if configured)
    if getattr(settings, "applicationinsights_connection_string", None):
        try:
            from azure.monitor.opentelemetry import configure_azure_monitor  # type: ignore

            sampling_ratio = getattr(settings, "applicationinsights_sampling_ratio", 0.5)
            configure_azure_monitor(
                connection_string=settings.applicationinsights_connection_string,
                sampling_ratio=sampling_ratio,
            )
            logger.info("Azure Monitor OpenTelemetry initialized successfully")
            _telemetry_initialized = True
            _telemetry_backend = "azure-monitor"
            return True
        except ImportError:
            logger.info(
                "azure-monitor-opentelemetry not installed; attempting standard OpenTelemetry SDK setup"
            )
        except Exception as exc:
            logger.warning("Failed to initialize Azure Monitor OpenTelemetry: %s", exc)

    # 2. Standard OpenTelemetry SDK (if enabled or OTLP endpoint configured)
    if settings.otel_enabled or settings.otel_exporter_otlp_endpoint:
        try:
            from opentelemetry import trace
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.resources import Resource

            # Only configure if not already configured
            current_provider = trace.get_tracer_provider()
            if not isinstance(current_provider, TracerProvider):
                resource = Resource.create({
                    "service.name": settings.service_name,
                    "service.instance.id": f"{settings.service_name}-node-1",
                    "deployment.environment": settings.environment,
                })
                provider = TracerProvider(resource=resource)

                if settings.otel_exporter_otlp_endpoint:
                    try:
                        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
                        from opentelemetry.sdk.trace.export import BatchSpanProcessor

                        exporter = OTLPSpanExporter(
                            endpoint=settings.otel_exporter_otlp_endpoint,
                            insecure=True,
                        )
                        provider.add_span_processor(BatchSpanProcessor(exporter))
                    except Exception as otlp_err:
                        logger.debug("OTLP exporter attachment skipped: %s", otlp_err)

                trace.set_tracer_provider(provider)

            logger.info("OpenTelemetry SDK initialized successfully")
            _telemetry_initialized = True
            _telemetry_backend = "opentelemetry-sdk"
            return True
        except ImportError:
            logger.debug("opentelemetry SDK not available in current environment")
        except Exception as exc:
            logger.warning("Failed to initialize OpenTelemetry SDK: %s", exc)

    _telemetry_backend = "none"
    return False


def get_tracer(name: str = "ams-business-service"):
    """Return an OpenTelemetry tracer instance or safe fallback."""
    try:
        from opentelemetry import trace

        return trace.get_tracer(name)
    except ImportError:
        class DummySpan:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                pass

            def set_attribute(self, key, value):
                pass

            def record_exception(self, exc):
                pass

            def set_status(self, status, description=None):
                pass

        class DummyTracer:
            def start_as_current_span(self, name, *args, **kwargs):
                return DummySpan()

        return DummyTracer()

