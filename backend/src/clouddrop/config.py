"""Runtime settings, read once from environment variables."""

import os
from dataclasses import dataclass

DEFAULT_EMAIL_DOMAIN = "thapar.edu"


@dataclass(frozen=True)
class Settings:
    table_name: str
    bucket_name: str
    region: str
    max_file_bytes: int
    max_files_per_user: int = 200
    allowed_email_domain: str = DEFAULT_EMAIL_DOMAIN
    upload_url_ttl: int = 900  # seconds a pre-signed upload stays valid
    download_url_ttl: int = 300
    pending_ttl: int = 3600  # seconds before an unconfirmed upload record expires
    s3_endpoint_url: str | None = None  # only set in local mode
    api_name: str = ""
    api_stage: str = "prod"
    metric_functions: tuple[str, ...] = ()


def load_settings(env=None) -> Settings:
    env = os.environ if env is None else env
    return Settings(
        table_name=env["TABLE_NAME"],
        bucket_name=env["BUCKET_NAME"],
        region=env.get("AWS_REGION") or env.get("AWS_DEFAULT_REGION") or "ap-south-1",
        max_file_bytes=int(env.get("MAX_FILE_MB", "25")) * 1024 * 1024,
        max_files_per_user=int(env.get("MAX_FILES_PER_USER", "200")),
        allowed_email_domain=env.get("ALLOWED_EMAIL_DOMAIN", DEFAULT_EMAIL_DOMAIN).lower(),
        s3_endpoint_url=env.get("S3_ENDPOINT_URL") or None,
        api_name=env.get("API_NAME", ""),
        api_stage=env.get("API_STAGE", "prod"),
        metric_functions=tuple(name for name in env.get("METRIC_FUNCTIONS", "").split(",") if name),
    )
