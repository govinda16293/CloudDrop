from datetime import datetime, timezone

import pytest
import requests
from botocore.exceptions import ClientError

from clouddrop.errors import ApiError
from helpers import PDF, browser_upload, upload_payload


def share(service, user, body=PDF, **overrides):
    """Create, upload and confirm a file. Returns its public record."""
    created = service.create_upload(user, upload_payload(size=len(body), **overrides))
    browser_upload(created["upload"], body)
    return service.complete_upload(user, created["file"]["fileId"])


def error(call, *args):
    with pytest.raises(ApiError) as caught:
        call(*args)
    return caught.value


# ---- create ---------------------------------------------------------------


def test_create_upload_returns_a_pending_record_and_an_upload_form(service, asha, settings):
    created = service.create_upload(asha, upload_payload())
    file = created["file"]
    assert file["status"] == "PENDING"
    assert file["title"] == "Unit 3 notes" and file["uploaderName"] == "Asha"
    assert file["downloadCount"] == 0
    assert created["upload"]["fields"]["key"] == f"pending/{file['fileId']}"
    assert created["upload"]["url"].startswith("https://")


def test_create_upload_rejects_invalid_metadata_and_stores_nothing(service, asha, table):
    assert error(service.create_upload, asha, upload_payload(semester=99)).status == 400
    assert table.scan()["Count"] == 0


def test_pending_record_expires_one_hour_after_creation_in_epoch_seconds(service, asha, repo):
    file_id = service.create_upload(asha, upload_payload())["file"]["fileId"]
    stored = repo.get(file_id)
    first_tick = datetime(2026, 11, 20, 10, 0, 1, tzinfo=timezone.utc)  # the fixture clock
    assert stored["expiresAt"] == int(first_tick.timestamp()) + 3600
    assert stored["expiresAt"] < 10_000_000_000, "DynamoDB TTL needs seconds, not milliseconds"


def test_public_record_hides_internal_fields(service, asha):
    file = share(service, asha)
    assert set(file) == {
        "fileId", "status", "title", "fileName", "contentType", "size", "subjectCode", "semester",
        "resourceType", "tags", "description", "uploaderName", "createdAt", "downloadCount",
        "isMine", "canDelete",
    }


# ---- complete -------------------------------------------------------------


def test_file_is_hidden_until_the_upload_is_confirmed(service, asha, ravi):
    created = service.create_upload(asha, upload_payload())
    file_id = created["file"]["fileId"]
    browser_upload(created["upload"])
    assert service.list_files(ravi, {})["items"] == []
    assert error(service.get_file, ravi, file_id).status == 404
    assert error(service.get_download, ravi, file_id).status == 404

    service.complete_upload(asha, file_id)

    assert [f["fileId"] for f in service.list_files(ravi, {})["items"]] == [file_id]
    assert service.get_file(ravi, file_id)["status"] == "ACTIVE"


def test_complete_records_the_real_size_not_the_claimed_one(service, asha):
    created = service.create_upload(asha, upload_payload(size=5))
    browser_upload(created["upload"], PDF)
    assert service.complete_upload(asha, created["file"]["fileId"])["size"] == len(PDF)


def test_complete_before_the_file_is_uploaded_is_a_409(service, asha):
    file_id = service.create_upload(asha, upload_payload())["file"]["fileId"]
    failure = error(service.complete_upload, asha, file_id)
    assert (failure.status, failure.code) == (409, "upload_incomplete")


def test_complete_by_someone_else_is_forbidden(service, asha, ravi):
    created = service.create_upload(asha, upload_payload())
    browser_upload(created["upload"])
    assert error(service.complete_upload, ravi, created["file"]["fileId"]).status == 403


def test_complete_unknown_file_is_a_404(service, asha):
    assert error(service.complete_upload, asha, "ghost").status == 404


def test_complete_twice_returns_the_same_file(service, asha, emitted):
    file = share(service, asha)
    again = service.complete_upload(asha, file["fileId"])
    assert again == file
    assert emitted.count("FilesUploaded") == 1


def test_oversize_object_is_rejected_and_cleaned_up(service, asha, repo, storage, settings):
    # The mock does not enforce the pre-signed size range, which lets this
    # test prove the server-side check works on its own.
    created = service.create_upload(asha, upload_payload())
    file_id = created["file"]["fileId"]
    browser_upload(created["upload"], b"x" * (settings.max_file_bytes + 1))
    failure = error(service.complete_upload, asha, file_id)
    assert failure.status == 400 and "too large" in failure.message.lower()
    assert repo.get(file_id) is None
    assert storage.head(f"pending/{file_id}") is None


def test_complete_moves_the_object_out_of_pending(service, asha, storage):
    file = share(service, asha)
    assert storage.head(f"pending/{file['fileId']}") is None
    assert storage.head(f"files/{file['fileId']}") == {"size": len(PDF)}


def test_complete_racing_with_another_complete_still_succeeds(service, asha, storage, repo):
    # Two browser tabs confirm at once: the other request activates the record
    # between this request's copy and its own activation.
    created = service.create_upload(asha, upload_payload())
    file_id = created["file"]["fileId"]
    browser_upload(created["upload"])
    real_copy = storage.copy_to_final

    def copy_then_the_other_request_wins(pending_key, final_key, content_type):
        real_copy(pending_key, final_key, content_type)
        repo.activate(file_id, final_key, len(PDF))

    storage.copy_to_final = copy_then_the_other_request_wins
    assert service.complete_upload(asha, file_id)["status"] == "ACTIVE"


def aws_failure(operation):
    return ClientError({"Error": {"Code": "InternalServerError", "Message": "boom"}}, operation)


def test_storage_failure_during_complete_is_not_swallowed(service, asha, storage):
    created = service.create_upload(asha, upload_payload())
    browser_upload(created["upload"])

    def broken(*args):
        raise aws_failure("CopyObject")

    storage.copy_to_final = broken
    with pytest.raises(ClientError):
        service.complete_upload(asha, created["file"]["fileId"])


def test_complete_can_be_retried_after_the_database_step_fails(service, asha, storage, repo):
    # The object was copied but DynamoDB failed before the record was marked
    # ACTIVE. The upload must not be stuck: trying again has to succeed.
    created = service.create_upload(asha, upload_payload())
    file_id = created["file"]["fileId"]
    browser_upload(created["upload"])
    real_activate = repo.activate

    def fail_once(*args):
        repo.activate = real_activate
        raise aws_failure("UpdateItem")

    repo.activate = fail_once
    with pytest.raises(ClientError):
        service.complete_upload(asha, file_id)
    assert repo.get(file_id)["status"] == "PENDING"

    assert service.complete_upload(asha, file_id)["status"] == "ACTIVE"
    assert storage.head(f"files/{file_id}") == {"size": len(PDF)}
    assert storage.head(f"pending/{file_id}") is None


def test_complete_succeeds_even_if_the_pending_copy_can_not_be_removed(service, asha, storage):
    # Clean-up is best effort; the bucket's lifecycle rule empties pending/ daily.
    created = service.create_upload(asha, upload_payload())
    browser_upload(created["upload"])
    real_delete = storage.delete

    def refuse_pending(key):
        if key.startswith("pending/"):
            raise aws_failure("DeleteObject")
        real_delete(key)

    storage.delete = refuse_pending
    assert service.complete_upload(asha, created["file"]["fileId"])["status"] == "ACTIVE"


# ---- list -----------------------------------------------------------------


def test_list_applies_filters_from_query_parameters(service, asha, ravi):
    share(service, asha, title="Cloud notes", subjectCode="UCS531", semester=5)
    share(service, ravi, title="Maths sheet", subjectCode="UMA010", semester=1, resourceType="question-paper")
    assert [f["title"] for f in service.list_files(asha, {"subject": "uma010"})["items"]] == ["Maths sheet"]
    assert [f["title"] for f in service.list_files(asha, {"semester": "5"})["items"]] == ["Cloud notes"]
    assert [f["title"] for f in service.list_files(asha, {"type": "question-paper"})["items"]] == ["Maths sheet"]
    assert [f["title"] for f in service.list_files(asha, {"q": "CLOUD"})["items"]] == ["Cloud notes"]


def test_search_finds_a_file_by_tag_file_name_and_uploader(service, asha):
    share(service, asha, title="Unit 3", fileName="hypervisors.pdf", tags=["xen"])
    for query in ("xen", "hypervisors", "asha"):
        assert len(service.list_files(asha, {"q": query})["items"]) == 1, query


def test_mine_lists_only_my_uploads(service, asha, ravi):
    share(service, asha, title="By Asha")
    share(service, ravi, title="By Ravi")
    mine = service.list_files(asha, {"mine": "1"})["items"]
    assert [f["title"] for f in mine] == ["By Asha"]
    assert mine[0]["isMine"] is True


def test_list_pages_with_a_cursor(service, asha):
    for n in range(5):
        share(service, asha, title=f"File {n}")
    first = service.list_files(asha, {"limit": "2"})
    second = service.list_files(asha, {"limit": "2", "cursor": first["nextCursor"]})
    assert [f["title"] for f in first["items"]] == ["File 4", "File 3"]
    assert [f["title"] for f in second["items"]] == ["File 2", "File 1"]


def test_list_with_bad_parameters_is_a_400(service, asha):
    assert error(service.list_files, asha, {"semester": "40"}).status == 400


# ---- download -------------------------------------------------------------


def test_download_returns_a_working_link_and_counts(service, asha, ravi, emitted):
    file = share(service, asha, fileName="unit3.pdf")
    first = service.get_download(ravi, file["fileId"])
    second = service.get_download(asha, file["fileId"])
    assert requests.get(first["url"], timeout=5).content == PDF
    assert first["fileName"] == "unit3.pdf"
    assert (first["downloadCount"], second["downloadCount"]) == (1, 2)
    assert service.get_file(ravi, file["fileId"])["downloadCount"] == 2
    assert emitted.count("FilesDownloaded") == 2


def test_download_of_unknown_file_is_a_404(service, asha):
    assert error(service.get_download, asha, "ghost").status == 404


# ---- delete ---------------------------------------------------------------


def test_owner_can_delete_and_the_object_goes_too(service, asha, storage, emitted):
    file = share(service, asha)
    service.delete_file(asha, file["fileId"])
    assert error(service.get_file, asha, file["fileId"]).status == 404
    assert storage.head(f"files/{file['fileId']}") is None
    assert service.list_files(asha, {})["items"] == []
    assert emitted.count("FilesDeleted") == 1


def test_admin_can_delete_any_file(service, asha, admin):
    file = share(service, asha)
    service.delete_file(admin, file["fileId"])
    assert error(service.get_file, asha, file["fileId"]).status == 404


def test_other_students_can_not_delete(service, asha, ravi):
    file = share(service, asha)
    assert error(service.delete_file, ravi, file["fileId"]).status == 403
    assert service.get_file(ravi, file["fileId"])["status"] == "ACTIVE"


def test_owner_can_cancel_a_pending_upload(service, asha, repo, storage):
    created = service.create_upload(asha, upload_payload())
    file_id = created["file"]["fileId"]
    browser_upload(created["upload"])
    service.delete_file(asha, file_id)
    assert repo.get(file_id) is None and storage.head(f"pending/{file_id}") is None


def test_delete_unknown_file_is_a_404(service, asha):
    assert error(service.delete_file, asha, "ghost").status == 404


def test_can_delete_flag_matches_what_delete_allows(service, asha, ravi, admin):
    file_id = share(service, asha)["fileId"]
    assert service.get_file(asha, file_id)["canDelete"] is True
    assert service.get_file(ravi, file_id)["canDelete"] is False
    assert service.get_file(admin, file_id)["canDelete"] is True


# ---- limits and stats -----------------------------------------------------


def test_limits_describe_the_upload_rules(service, settings):
    limits = service.limits()
    assert limits["maxFileBytes"] == settings.max_file_bytes
    assert ".pdf" in limits["allowedExtensions"] and ".exe" not in limits["allowedExtensions"]
    assert "notes" in limits["resourceTypes"]
    assert limits["maxTags"] == 8


def test_stats_on_an_empty_library(service):
    stats = service.stats()
    assert stats["totals"] == {"files": 0, "bytes": 0, "downloads": 0, "uploaders": 0}
    assert stats["bySubject"] == [] and stats["topDownloads"] == [] and stats["recentUploads"] == []


def test_stats_totals_and_breakdowns(service, asha, ravi):
    a = share(service, asha, title="File A", subjectCode="UCS531", semester=5, resourceType="notes")
    share(service, asha, title="File B", subjectCode="UCS531", semester=5, resourceType="slides")
    c = share(service, ravi, title="File C", subjectCode="UMA010", semester=1, resourceType="notes")
    service.create_upload(ravi, upload_payload(title="never confirmed"))
    for _ in range(3):
        service.get_download(ravi, a["fileId"])
    service.get_download(asha, c["fileId"])

    stats = service.stats()

    assert stats["totals"] == {"files": 3, "bytes": 3 * len(PDF), "downloads": 4, "uploaders": 2}
    assert stats["bySubject"] == [
        {"subjectCode": "UCS531", "files": 2, "downloads": 3},
        {"subjectCode": "UMA010", "files": 1, "downloads": 1},
    ]
    assert stats["byType"] == [{"resourceType": "notes", "files": 2}, {"resourceType": "slides", "files": 1}]
    assert stats["bySemester"] == [{"semester": 1, "files": 1}, {"semester": 5, "files": 2}]
    assert [f["title"] for f in stats["topDownloads"]] == ["File A", "File C"]
    assert [f["title"] for f in stats["recentUploads"]] == ["File C", "File B", "File A"]
    assert set(stats["topDownloads"][0]) == {
        "fileId", "title", "subjectCode", "uploaderName", "downloadCount", "createdAt", "size",
    }


# ---- per-user limit --------------------------------------------------------


@pytest.fixture
def small_quota(repo, storage, settings, clock, emitted):
    from dataclasses import replace

    from clouddrop.service import FileService

    return FileService(repo, storage, replace(settings, max_files_per_user=2), now=clock, emit=lambda name, value=1: None)


def test_upload_is_refused_once_the_user_has_the_maximum_number_of_files(small_quota, asha, table):
    share(small_quota, asha, title="First file")
    share(small_quota, asha, title="Second file")
    failure = error(small_quota.create_upload, asha, upload_payload(title="Third file"))
    assert (failure.status, failure.code) == (409, "quota_exceeded")
    assert "2 files" in failure.message
    assert table.scan()["Count"] == 2, "the refused upload must not leave a record behind"


def test_the_limit_is_per_user_and_frees_up_on_delete(small_quota, asha, ravi):
    first = share(small_quota, asha, title="First file")
    share(small_quota, asha, title="Second file")
    share(small_quota, ravi, title="Ravi is unaffected")
    small_quota.delete_file(asha, first["fileId"])
    assert share(small_quota, asha, title="Room again")["status"] == "ACTIVE"
