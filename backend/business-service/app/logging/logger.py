"""
Structured logging setup (CHG-AZ-004). Uses stdlib logging with an optional JSON
formatter and CorrelationIdFilter so log lines are directly ingestible by
Azure Application Insights, Azure Monitor, Log Analytics, and ClickHouse observability pipelines.
"""
import logging
import sys
import json
from datetime import datetime, timezone

from app.config.settings import get_settings


class CorrelationIdFilter(logging.Filter):
    """Injects active request correlation_id from contextvars into standard LogRecord."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            from app.middleware.request_context import get_correlation_id
            cid = get_correlation_id() or "-"
        except Exception:
            cid = "-"
        record.correlation_id = cid
        record.request_id = cid
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        cid = getattr(record, "correlation_id", None)
        if not cid or cid == "-":
            try:
                from app.middleware.request_context import get_correlation_id
                cid = get_correlation_id()
            except Exception:
                cid = None

        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
        }
        if cid:
            payload["correlation_id"] = cid
            payload["request_id"] = cid

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        extra = getattr(record, "extra_fields", None)
        if extra:
            payload.update(extra)
        return json.dumps(payload)


def configure_logging() -> None:
    settings = get_settings()
    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())

    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(CorrelationIdFilter())
    if settings.log_json:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] [%(correlation_id)s] %(message)s")
        )
    root.handlers = [handler]

    # Quiet noisy libraries down unless the whole app is in DEBUG.
    if settings.log_level.upper() != "DEBUG":
        for noisy in ("sqlalchemy.engine", "aiokafka", "httpx", "apscheduler", "uvicorn.access"):
            logging.getLogger(noisy).setLevel(logging.ERROR)

        # Also silence specific noisy loggers that don't follow the prefix rule
        logging.getLogger("apscheduler.executors.default").setLevel(logging.ERROR)
        logging.getLogger("apscheduler.scheduler").setLevel(logging.ERROR)
        logging.getLogger("aiokafka").setLevel(logging.CRITICAL)
        logging.getLogger("app.kafka.consumer").setLevel(logging.CRITICAL)
        logging.getLogger("asyncio").setLevel(logging.CRITICAL)
        logging.getLogger("uvicorn.access").setLevel(logging.ERROR)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
