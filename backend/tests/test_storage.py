import base64
import json
from urllib.parse import parse_qs, urlparse

import requests

PDF = b"%PDF-1.7 fake notes " * 10


def upload(storage, key, body=PDF, content_type="application/pdf"):
    """Do what the browser does: POST the form fields, then the file."""
    form = storage.presign_upload(key, content_type, size=len(body), ttl=900)
    response = requests.post(form["url"], data=form["fields"], files={"file": ("x.pdf", body)}, timeout=5)
    assert response.status_code in (200, 201, 204), response.text
    return form


def test_presigned_upload_policy_pins_key_type_and_exact_size(storage):
    # Exact size, not "up to the limit": a leaked or replayed form can not be
    # used to store something bigger than what the API approved.
    form = storage.presign_upload("pending/f1", "application/pdf", size=5000, ttl=900)
    assert form["fields"]["key"] == "pending/f1"
    assert form["fields"]["Content-Type"] == "application/pdf"
    conditions = json.loads(base64.b64decode(form["fields"]["policy"]))["conditions"]
    assert ["content-length-range", 5000, 5000] in conditions
    assert {"Content-Type": "application/pdf"} in conditions
    assert {"key": "pending/f1"} in conditions


def test_presigned_urls_use_the_regional_endpoint_and_sigv4(storage, settings):
    # The global endpoint answers a new bucket with a redirect, which a
    # browser's cross-origin POST can not follow.
    form = storage.presign_upload("pending/f1", "application/pdf", size=5000, ttl=900)
    assert urlparse(form["url"]).hostname == f"{settings.bucket_name}.s3.ap-south-1.amazonaws.com"
    assert form["fields"]["x-amz-algorithm"] == "AWS4-HMAC-SHA256"
    download = urlparse(storage.presign_download("files/f1", "notes.pdf", ttl=300))
    assert download.hostname == f"{settings.bucket_name}.s3.ap-south-1.amazonaws.com"
    assert parse_qs(download.query)["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]


def test_head_returns_size_after_upload_and_none_before(storage):
    assert storage.head("pending/f1") is None
    upload(storage, "pending/f1")
    assert storage.head("pending/f1") == {"size": len(PDF)}


def test_copy_to_final_copies_the_object_and_sets_its_content_type(storage, s3, settings):
    upload(storage, "pending/f1")
    storage.copy_to_final("pending/f1", "files/f1", "application/pdf")
    # The pending copy stays until the caller has recorded success, so a
    # failure in between can be retried.
    assert storage.head("pending/f1") == {"size": len(PDF)}
    stored = s3.get_object(Bucket=settings.bucket_name, Key="files/f1")
    assert stored["Body"].read() == PDF
    assert stored["ContentType"] == "application/pdf"


def test_presigned_download_returns_the_bytes_as_an_attachment(storage):
    upload(storage, "pending/f1")
    storage.copy_to_final("pending/f1", "files/f1", "application/pdf")
    url = storage.presign_download("files/f1", "unit3 notes (final).pdf", ttl=300)
    query = parse_qs(urlparse(url).query)
    assert query["response-content-disposition"] == ['attachment; filename="unit3 notes (final).pdf"']
    assert query["X-Amz-Expires"] == ["300"]
    assert requests.get(url, timeout=5).content == PDF


def test_delete_removes_the_object(storage):
    upload(storage, "pending/f1")
    storage.delete("pending/f1")
    assert storage.head("pending/f1") is None


def test_delete_of_a_missing_object_is_not_an_error(storage):
    storage.delete("pending/never-existed")
