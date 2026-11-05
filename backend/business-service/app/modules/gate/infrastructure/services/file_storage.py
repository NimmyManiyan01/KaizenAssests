"""
File Storage Service for validating and persisting uploaded images and documents.
"""
from __future__ import annotations

import os
import uuid
from typing import Any, Callable

from app.modules.gate.application.exceptions import InvalidFileException

ALLOWED_MIME_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


async def _run_in_thread(func: Callable[..., Any], *args: Any) -> Any:
    """Run synchronous blocking I/O in worker thread to prevent event-loop starvation."""
    try:
        import anyio
        return await anyio.to_thread.run_sync(func, *args)
    except Exception:
        pass
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, func, *args)
    except Exception:
        return func(*args)


class FileStorageService:
    def __init__(self, storage_dir: str = "media_uploads") -> None:
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)

    def validate_file(self, content: bytes, filename: str, content_type: str | None) -> None:
        if not content:
            raise InvalidFileException(f"File '{filename}' is empty")

        if len(content) > MAX_FILE_SIZE_BYTES:
            raise InvalidFileException(
                f"File '{filename}' exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES / (1024 * 1024):.0f} MB"
            )

        if content_type and content_type.lower() not in ALLOWED_MIME_TYPES:
            # Fall back to checking filename extension
            ext = os.path.splitext(filename)[1].lower()
            if ext not in (".jpg", ".jpeg", ".png", ".webp", ".pdf"):
                raise InvalidFileException(
                    f"Unsupported file type '{content_type or ext}' for file '{filename}'. Supported types: JPG, PNG, WEBP, PDF."
                )

    async def save_file(self, content: bytes, filename: str, subfolder: str = "general") -> str:
        folder_path = os.path.join(self.storage_dir, subfolder)
        os.makedirs(folder_path, exist_ok=True)

        ext = os.path.splitext(filename)[1].lower() or ".bin"
        unique_name = f"{uuid.uuid4()}{ext}"
        file_path = os.path.join(folder_path, unique_name)

        def _write_disk() -> None:
            with open(file_path, "wb") as f:
                f.write(content)

        await _run_in_thread(_write_disk)
        return file_path.replace("\\", "/")
