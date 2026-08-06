"""
Scopit - Storage Service

Abstracts file storage behind a unified interface.
Supports local filesystem (development) and Cloudflare R2 (production).
R2 uses S3-compatible API via boto3.
"""
import os
import shutil
import tempfile
from contextlib import contextmanager
from functools import lru_cache
from typing import Generator, Optional

from app.core.config import settings


class StorageBackend:
    """Base storage interface."""

    def write(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        raise NotImplementedError

    def read(self, key: str) -> bytes:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError

    @contextmanager
    def open_for_processing(self, key: str, suffix: str = "") -> Generator[str, None, None]:
        """Provide a local file path for read/write processing.

        On exit the (possibly modified) file is synced back to storage.
        For local storage the actual file is yielded directly (zero-copy).
        For R2 a temp file is used and uploaded on exit.
        """
        raise NotImplementedError

    @contextmanager
    def temp_workspace(self) -> Generator[str, None, None]:
        """Provide a temporary directory for multi-file processing."""
        with tempfile.TemporaryDirectory(prefix="scopit_") as tmpdir:
            yield tmpdir


class LocalStorage(StorageBackend):
    """Store files on the local filesystem under STORAGE_BASE_DIR."""

    def __init__(self, base_dir: str):
        self.base_dir = os.path.abspath(base_dir)

    def _path(self, key: str) -> str:
        return os.path.join(self.base_dir, key)

    def write(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)

    def read(self, key: str) -> bytes:
        with open(self._path(key), "rb") as f:
            return f.read()

    def exists(self, key: str) -> bool:
        return os.path.exists(self._path(key))

    def delete(self, key: str) -> None:
        path = self._path(key)
        if os.path.exists(path):
            os.remove(path)

    @contextmanager
    def open_for_processing(self, key: str, suffix: str = "") -> Generator[str, None, None]:
        """For local storage, yield the actual file path (zero-copy)."""
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        yield path

    def copy(self, src_key: str, dst_key: str) -> None:
        """Copy a file within local storage."""
        src = self._path(src_key)
        dst = self._path(dst_key)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)


class R2Storage(StorageBackend):
    """Store files in Cloudflare R2 via S3-compatible API."""

    def __init__(self):
        import boto3
        from botocore.config import Config as BotoConfig

        self.client = boto3.client(
            "s3",
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            config=BotoConfig(signature_version="s3v4"),
            region_name="auto",
        )
        self.bucket = settings.R2_BUCKET_NAME

    def write(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    def read(self, key: str) -> bytes:
        resp = self.client.get_object(Bucket=self.bucket, Key=key)
        return resp["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def delete(self, key: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception:
            pass

    @contextmanager
    def open_for_processing(self, key: str, suffix: str = "") -> Generator[str, None, None]:
        """Download from R2 to temp, yield path, upload back on exit."""
        if not suffix:
            _, suffix = os.path.splitext(key)
        fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="scopit_")
        try:
            # Download existing file if it exists
            try:
                data = self.read(key)
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
            except Exception:
                os.close(fd)

            yield tmp_path

            # Upload modified file back to R2
            if os.path.exists(tmp_path):
                content_type = self._guess_content_type(key)
                with open(tmp_path, "rb") as f:
                    self.write(key, f.read(), content_type)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def copy(self, src_key: str, dst_key: str) -> None:
        """Copy an object within R2."""
        self.client.copy_object(
            Bucket=self.bucket,
            Key=dst_key,
            CopySource={"Bucket": self.bucket, "Key": src_key},
        )

    @staticmethod
    def _guess_content_type(key: str) -> str:
        ext = os.path.splitext(key)[1].lower()
        return {
            ".pdf": "application/pdf",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
        }.get(ext, "application/octet-stream")


_storage: Optional[StorageBackend] = None


def get_storage() -> StorageBackend:
    """Get the configured storage backend (singleton)."""
    global _storage
    if _storage is None:
        if settings.STORAGE_PROVIDER == "r2":
            _storage = R2Storage()
        else:
            _storage = LocalStorage(settings.STORAGE_BASE_DIR)
    return _storage
