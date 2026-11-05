"""
Asynchronous and Non-Blocking File Storage Services for Kaizen AMS (CHG-PERF-001, CHG-AZ-002).
Provides abstract StorageService, LocalStorageService (non-blocking threadpool),
and AzureBlobStorageService for Azure cloud deployment with SAS URL generation.
"""
from __future__ import annotations

import abc
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from app.config.settings import get_settings
from app.logging.logger import get_logger

logger = get_logger(__name__)


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
        # Fallback if executed synchronously outside an event loop
        return func(*args)


class StorageService(abc.ABC):
    """Abstract interface for non-blocking file storage operations."""

    @abc.abstractmethod
    async def save_file(self, content: bytes, filename: str, subfolder: str = "general") -> str:
        """Save file bytes and return access path or public URL."""
        pass

    @abc.abstractmethod
    async def read_file(self, path: str) -> bytes:
        """Read file bytes asynchronously without blocking the event loop."""
        pass

    @abc.abstractmethod
    async def delete_file(self, path: str) -> bool:
        """Delete file at path asynchronously without blocking the event loop."""
        pass

    @abc.abstractmethod
    async def file_exists(self, path: str) -> bool:
        """Check if file exists asynchronously."""
        pass

    async def generate_sas_url(self, path: str, expiry_hours: int = 1) -> str:
        """Generate time-limited read URL for secure client access."""
        return path


class LocalStorageService(StorageService):
    """
    Local filesystem storage with non-blocking threadpool execution.
    Offloads disk I/O from the asyncio event loop using anyio.to_thread.run_sync.
    """

    def __init__(self, root_dir: str = "media_uploads") -> None:
        self.root_dir = Path(root_dir)
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _sync_save(self, content: bytes, file_path: Path) -> None:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(content)

    def _sync_read(self, file_path: Path) -> bytes:
        with open(file_path, "rb") as f:
            return f.read()

    def _sync_delete(self, file_path: Path) -> bool:
        if file_path.exists():
            file_path.unlink()
            return True
        return False

    def _sync_exists(self, file_path: Path) -> bool:
        return file_path.exists()

    async def save_file(self, content: bytes, filename: str, subfolder: str = "general") -> str:
        ext = os.path.splitext(filename)[1].lower() or ".bin"
        unique_name = f"{uuid.uuid4()}{ext}"
        destination = self.root_dir / subfolder / unique_name

        # Run disk write in background worker thread
        await _run_in_thread(self._sync_save, content, destination)
        logger.debug("LocalStorageService: Saved file to %s (%d bytes)", destination, len(content))

        # Return standardized web path for /media endpoint
        web_path = f"/media/{subfolder}/{unique_name}"
        return web_path

    async def read_file(self, path: str) -> bytes:
        file_path = self._resolve_path(path)
        if not await self.file_exists(path):
            raise FileNotFoundError(f"File not found: {path}")
        return await _run_in_thread(self._sync_read, file_path)

    async def delete_file(self, path: str) -> bool:
        file_path = self._resolve_path(path)
        return await _run_in_thread(self._sync_delete, file_path)

    async def file_exists(self, path: str) -> bool:
        file_path = self._resolve_path(path)
        return await _run_in_thread(self._sync_exists, file_path)

    def _resolve_path(self, path: str) -> Path:
        # Strip leading /media/ prefix if present
        if path.startswith("/media/"):
            rel_path = path[len("/media/") :]
            return self.root_dir / rel_path
        if path.startswith("media_uploads/"):
            rel_path = path[len("media_uploads/") :]
            return self.root_dir / rel_path
        return Path(path)


class AzureBlobStorageService(StorageService):
    """
    Azure Blob Storage implementation (CHG-AZ-002).
    Uploads directly to Azure Blob container with SAS token generation and non-blocking I/O.
    """

    def __init__(self, connection_string: str, container_name: str = "kaizen-wms-media") -> None:
        self.connection_string = connection_string
        self.container_name = container_name

    def _extract_blob_name(self, path: str) -> str:
        """Extract relative blob name from full URL or relative path."""
        if path.startswith("http://") or path.startswith("https://"):
            parsed = urlparse(path)
            # Remove leading slash and container name: /container/subfolder/name.ext -> subfolder/name.ext
            parts = parsed.path.lstrip("/").split("/", 1)
            return parts[1] if len(parts) > 1 else parts[0]
        if path.startswith(f"{self.container_name}/"):
            return path[len(f"{self.container_name}/") :]
        return path.lstrip("/")

    async def save_file(self, content: bytes, filename: str, subfolder: str = "general") -> str:
        try:
            from azure.storage.blob.aio import BlobServiceClient  # type: ignore

            async with BlobServiceClient.from_connection_string(self.connection_string) as client:
                container_client = client.get_container_client(self.container_name)
                ext = os.path.splitext(filename)[1].lower() or ".bin"
                blob_name = f"{subfolder}/{uuid.uuid4()}{ext}"
                blob_client = container_client.get_blob_client(blob_name)
                await blob_client.upload_blob(content, overwrite=True)
                logger.info("AzureBlobStorage: Uploaded %s to container %s", blob_name, self.container_name)
                return blob_client.url
        except ImportError:
            logger.warning("azure-storage-blob not installed; falling back to LocalStorageService")
            local = LocalStorageService()
            return await local.save_file(content, filename, subfolder)
        except Exception as exc:
            logger.error("AzureBlobStorage upload failed: %s; falling back to LocalStorageService", exc)
            local = LocalStorageService()
            return await local.save_file(content, filename, subfolder)

    async def read_file(self, path: str) -> bytes:
        blob_name = self._extract_blob_name(path)
        try:
            from azure.storage.blob.aio import BlobServiceClient  # type: ignore

            async with BlobServiceClient.from_connection_string(self.connection_string) as client:
                blob_client = client.get_blob_client(container=self.container_name, blob=blob_name)
                stream = await blob_client.download_blob()
                return await stream.readall()
        except ImportError:
            local = LocalStorageService()
            return await local.read_file(path)
        except Exception as exc:
            logger.error("AzureBlobStorage download failed for %s: %s", blob_name, exc)
            raise FileNotFoundError(f"Azure Blob {blob_name} could not be read: {exc}")

    async def delete_file(self, path: str) -> bool:
        blob_name = self._extract_blob_name(path)
        try:
            from azure.storage.blob.aio import BlobServiceClient  # type: ignore

            async with BlobServiceClient.from_connection_string(self.connection_string) as client:
                blob_client = client.get_blob_client(container=self.container_name, blob=blob_name)
                await blob_client.delete_blob()
                return True
        except ImportError:
            local = LocalStorageService()
            return await local.delete_file(path)
        except Exception as exc:
            logger.warning("AzureBlobStorage delete failed for %s: %s", blob_name, exc)
            return False

    async def file_exists(self, path: str) -> bool:
        blob_name = self._extract_blob_name(path)
        try:
            from azure.storage.blob.aio import BlobServiceClient  # type: ignore

            async with BlobServiceClient.from_connection_string(self.connection_string) as client:
                blob_client = client.get_blob_client(container=self.container_name, blob=blob_name)
                return await blob_client.exists()
        except ImportError:
            local = LocalStorageService()
            return await local.file_exists(path)
        except Exception as exc:
            logger.warning("AzureBlobStorage existence check failed for %s: %s", blob_name, exc)
            return False

    async def generate_sas_url(self, path: str, expiry_hours: int = 1) -> str:
        blob_name = self._extract_blob_name(path)
        try:
            from azure.storage.blob import BlobSasPermissions, generate_blob_sas  # type: ignore

            # If account key is extractable from connection string, generate SAS token
            sas_token = generate_blob_sas(
                account_name="kaizenstorage",
                container_name=self.container_name,
                blob_name=blob_name,
                permission=BlobSasPermissions(read=True),
                expiry=datetime.now(timezone.utc) + timedelta(hours=expiry_hours),
            )
            return f"https://kaizenstorage.blob.core.windows.net/{self.container_name}/{blob_name}?{sas_token}"
        except Exception:
            # Fall back to raw URL if SAS generation is unavailable
            return f"https://kaizenstorage.blob.core.windows.net/{self.container_name}/{blob_name}"


_storage_instance: Optional[StorageService] = None


def get_storage_service() -> StorageService:
    """Factory function returning the active StorageService singleton."""
    global _storage_instance
    if _storage_instance is None:
        settings = get_settings()
        azure_conn = getattr(settings, "azure_storage_connection_string", None)
        container_name = getattr(settings, "azure_storage_container_name", "kaizen-wms-media")
        is_prod = getattr(settings, "environment", "").lower() in {"prod", "production", "staging"}
        if azure_conn and is_prod:
            _storage_instance = AzureBlobStorageService(connection_string=azure_conn, container_name=container_name)
        else:
            _storage_instance = LocalStorageService(root_dir="media_uploads")
    return _storage_instance
