from pathlib import Path


def test_compatibility_startup_registers_one_consumer_and_one_outbox_relay() -> None:
    main_source = Path(__file__).parents[2].joinpath("app", "main.py").read_text(encoding="utf-8")
    compatibility_block = main_source[main_source.index("    try:\n        await start_producer()") : main_source.index(
        '    logger.info("business-service started", extra={"extra_fields": {"environment": settings.environment}})'
    )]

    assert compatibility_block.count("asyncio.create_task(start_notification_consumer())") == 1
    assert compatibility_block.count('id="outbox-relay"') == 1
