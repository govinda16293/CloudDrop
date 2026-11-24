"""Build the service once per Lambda container and reuse it across requests."""

import boto3

from .config import Settings, load_settings
from .repository import FileRepository
from .service import FileService
from .storage import FileStorage, make_s3_client

_cache: dict = {}


def get_settings() -> Settings:
    if "settings" not in _cache:
        _cache["settings"] = load_settings()
    return _cache["settings"]


def get_service() -> FileService:
    if "service" not in _cache:
        settings = get_settings()
        table = boto3.resource("dynamodb", region_name=settings.region).Table(settings.table_name)
        storage = FileStorage(make_s3_client(settings.region, settings.s3_endpoint_url), settings.bucket_name)
        _cache["service"] = FileService(FileRepository(table), storage, settings)
    return _cache["service"]


def get_cloudwatch():
    if "cloudwatch" not in _cache:
        _cache["cloudwatch"] = boto3.client("cloudwatch", region_name=get_settings().region)
    return _cache["cloudwatch"]


def reset() -> None:
    """Forget everything built so far (tests and local mode change the environment)."""
    _cache.clear()
