"""
Outbox relay - counterpart of com.ams.common.outbox.OutboxRelay.
"""
from __future__ import annotations

from app.config.settings import get_settings
from app.database.session import session_scope
from app.events.outbox_repository import fetch_undelivered, mark_delivered
from app.kafka.producer import publish, is_producer_available
from app.logging.logger import get_logger

logger = get_logger(__name__)


_MAX_RETRIES = 5
_retry_counts: dict = {}


async def relay_once() -> None:
    if not is_producer_available():
        # Skip relay if Kafka is offline to avoid log noise in local dev
        return

    settings = get_settings()
    async with session_scope() as session:
        events = await fetch_undelivered(session, settings.outbox_batch_size)
        if not events:
            return

        delivered_ids = []
        dead_letter_ids = []
        for event in events:
            try:
                await publish(
                    event_type=event.event_type,
                    key=event.aggregate_id,
                    payload=event.payload.encode("utf-8")
                )
                delivered_ids.append(event.id)
                _retry_counts.pop(event.id, None)
                logger.debug(f"Relayed event {event.id} ({event.event_type})")
            except Exception as e:
                attempts = _retry_counts.get(event.id, 0) + 1
                _retry_counts[event.id] = attempts
                if attempts >= _MAX_RETRIES:
                    logger.critical(
                        f"OUTBOX DLQ ALERT: Event {event.id} ({event.event_type}) exceeded {_MAX_RETRIES} attempts. "
                        f"Moving to DLQ to unblock outbox relay. Error: {e}. Payload: {event.payload[:200]}"
                    )
                    dead_letter_ids.append(event.id)
                    _retry_counts.pop(event.id, None)
                else:
                    logger.warning(f"Failed to relay event {event.id} (attempt {attempts}/{_MAX_RETRIES}): {e}")

        all_processed = delivered_ids + dead_letter_ids
        if all_processed:
            await mark_delivered(session, all_processed)
            await session.commit()
            logger.info(f"Outbox relay batch processed: {len(delivered_ids)} delivered, {len(dead_letter_ids)} moved to DLQ")
