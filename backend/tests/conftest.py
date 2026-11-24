import boto3
import pytest
from moto import mock_aws

from clouddrop.config import Settings
from local.bootstrap import create_resources

REGION = "ap-south-1"
STACK = "clouddrop-test"
MAX_BYTES = 1024 * 1024  # 1 MB keeps the oversize tests cheap


@pytest.fixture
def settings():
    return Settings(
        table_name="clouddrop-test-files",
        bucket_name="clouddrop-test-files-123456789012",
        region=REGION,
        max_file_bytes=MAX_BYTES,
        api_name="clouddrop-test-api",
        metric_functions=("clouddrop-test-files", "clouddrop-test-admin"),
    )


@pytest.fixture
def aws(monkeypatch, settings):
    """Mock AWS with the table and bucket created from the real template."""
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        monkeypatch.setenv(name, "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    with mock_aws():
        create_resources(
            boto3.client("dynamodb", region_name=REGION),
            boto3.client("s3", region_name=REGION),
            settings.table_name,
            settings.bucket_name,
            REGION,
        )
        yield


@pytest.fixture
def table(aws, settings):
    return boto3.resource("dynamodb", region_name=REGION).Table(settings.table_name)


@pytest.fixture
def repo(table):
    from clouddrop.repository import FileRepository

    return FileRepository(table)


@pytest.fixture
def s3(aws, settings):
    from clouddrop.storage import make_s3_client

    return make_s3_client(settings.region)


@pytest.fixture
def storage(s3, settings):
    from clouddrop.storage import FileStorage

    return FileStorage(s3, settings.bucket_name)



@pytest.fixture
def clock():
    """A clock that moves one second forward each time it is read."""
    from datetime import datetime, timedelta, timezone

    state = {"now": datetime(2026, 11, 20, 10, 0, 0, tzinfo=timezone.utc)}

    def now():
        state["now"] += timedelta(seconds=1)
        return state["now"]

    return now


@pytest.fixture
def emitted():
    return []


@pytest.fixture
def service(repo, storage, settings, clock, emitted):
    from clouddrop.service import FileService

    return FileService(repo, storage, settings, now=clock, emit=lambda name, value=1: emitted.append(name))


@pytest.fixture
def asha():
    from clouddrop.service import User

    return User(id="user-asha", email="asha_be24@thapar.edu", name="Asha")


@pytest.fixture
def ravi():
    from clouddrop.service import User

    return User(id="user-ravi", email="ravi_be24@thapar.edu", name="Ravi")


@pytest.fixture
def admin():
    from clouddrop.service import User

    return User(id="user-admin", email="admin@thapar.edu", name="Admin", is_admin=True)


@pytest.fixture
def lambda_env(aws, settings, monkeypatch):
    """The environment variables the template gives the functions."""
    from clouddrop import wiring

    monkeypatch.setenv("TABLE_NAME", settings.table_name)
    monkeypatch.setenv("BUCKET_NAME", settings.bucket_name)
    monkeypatch.setenv("MAX_FILE_MB", "1")
    monkeypatch.setenv("STACK_NAME", STACK)
    monkeypatch.setenv("ALLOWED_EMAIL_DOMAIN", "thapar.edu")
    monkeypatch.setenv("API_NAME", settings.api_name)
    monkeypatch.setenv("METRIC_FUNCTIONS", ",".join(settings.metric_functions))
    monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)
    wiring.reset()
    yield
    wiring.reset()
