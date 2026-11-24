"""Use cases. Knows the rules; knows nothing about HTTP or about AWS APIs."""

import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

from botocore.exceptions import ClientError

from . import metrics
from .errors import ApiError, not_found
from .repository import ACTIVE, PENDING
from .validation import ALLOWED_EXTENSIONS, MAX_TAGS, RESOURCE_TYPES, parse_list_params, validate_upload

_PUBLIC_FIELDS = (
    "fileId", "status", "title", "fileName", "contentType", "size", "subjectCode", "semester",
    "resourceType", "tags", "description", "uploaderName", "createdAt", "downloadCount",
)
_BRIEF_FIELDS = ("fileId", "title", "subjectCode", "uploaderName", "downloadCount", "createdAt", "size")
_TOP_SUBJECTS = 10
_TOP_FILES = 5


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str
    is_admin: bool = False


def _pending_key(file_id: str) -> str:
    return f"pending/{file_id}"


def _final_key(file_id: str) -> str:
    return f"files/{file_id}"


def _public(item: dict, user: User) -> dict:
    record = {field: item[field] for field in _PUBLIC_FIELDS}
    record["isMine"] = item["uploaderId"] == user.id
    record["canDelete"] = record["isMine"] or user.is_admin
    return record


class FileService:
    def __init__(self, repo, storage, settings, now=None, new_id=None, emit=metrics.emit):
        self._repo = repo
        self._storage = storage
        self._settings = settings
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._new_id = new_id or (lambda: uuid.uuid4().hex)
        self._emit = emit

    def limits(self) -> dict:
        """The upload rules, so the browser does not keep its own copy."""
        return {
            "maxFileBytes": self._settings.max_file_bytes,
            "allowedExtensions": sorted(ALLOWED_EXTENSIONS),
            "resourceTypes": list(RESOURCE_TYPES),
            "maxTags": MAX_TAGS,
        }

    def create_upload(self, user: User, payload) -> dict:
        data = validate_upload(payload, self._settings.max_file_bytes)
        # A brake on one account filling the bucket. Two uploads started at the
        # same moment can both pass, so the limit can be overshot by a file or
        # two; that is fine for its purpose.
        limit = self._settings.max_files_per_user
        if self._repo.count_by_uploader(user.id) >= limit:
            raise ApiError(409, "quota_exceeded", f"You have reached the limit of {limit} files. Delete one to upload another.")
        file_id = self._new_id()
        now = self._now()
        item = {
            **data,
            "fileId": file_id,
            "status": PENDING,
            "uploaderId": user.id,
            "uploaderEmail": user.email,  # never sent to other students; kept so an admin can trace an upload
            "uploaderName": user.name,
            "createdAt": now.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            "downloadCount": 0,
            "searchText": " ".join(
                [data["title"], data["fileName"], data["subjectCode"], *data["tags"], user.name]
            ).lower(),
            # DynamoDB TTL (epoch seconds) removes the record if the upload is never confirmed.
            "expiresAt": int(now.timestamp()) + self._settings.pending_ttl,
        }
        self._repo.put_pending(item)
        upload = self._storage.presign_upload(
            _pending_key(file_id), data["contentType"], data["size"], self._settings.upload_url_ttl
        )
        return {"file": _public(item, user), "upload": upload}

    def complete_upload(self, user: User, file_id: str) -> dict:
        item = self._repo.get(file_id)
        if item is None:
            raise not_found()
        if item["uploaderId"] != user.id:
            raise ApiError(403, "forbidden", "Only the uploader can confirm this upload.")
        if item["status"] == ACTIVE:
            return _public(item, user)

        pending_key, final_key = _pending_key(file_id), _final_key(file_id)
        uploaded = self._storage.head(pending_key)
        if uploaded is None:
            raise ApiError(409, "upload_incomplete", "The file has not finished uploading yet.")
        if uploaded["size"] > self._settings.max_file_bytes:
            self._repo.delete(file_id)
            self._storage.delete(pending_key)
            raise ApiError(400, "validation_error", "The uploaded file is too large.")

        activated, failure = None, None
        try:
            self._storage.copy_to_final(pending_key, final_key, item["contentType"])
            activated = self._repo.activate(file_id, final_key, uploaded["size"])
        except ClientError as error:
            failure = error
        if activated is None:
            # Another request for the same file (a second tab, a retry) may have
            # confirmed it between our check and our move. If so, that is success.
            current = self._repo.get(file_id)
            if current and current["status"] == ACTIVE:
                return _public(current, user)
            raise failure or not_found()
        try:
            # Only now, with the record ACTIVE. Had this come first, a failure
            # while activating would leave an upload that could never be confirmed.
            self._storage.delete(pending_key)
        except ClientError:
            pass  # the bucket's lifecycle rule empties pending/ within a day
        self._emit("FilesUploaded")
        return _public(activated, user)

    def _active(self, file_id: str) -> dict:
        item = self._repo.get(file_id)
        if item is None or item["status"] != ACTIVE:
            raise not_found()
        return item

    def get_file(self, user: User, file_id: str) -> dict:
        return _public(self._active(file_id), user)

    def list_files(self, user: User, params) -> dict:
        query = parse_list_params(params)
        items, cursor = self._repo.list_files(
            subject=query["subject"],
            uploader_id=user.id if query["mine"] else None,
            semester=query["semester"],
            resource_type=query["resource_type"],
            q=query["q"],
            limit=query["limit"],
            cursor=query["cursor"],
        )
        return {"items": [_public(item, user) for item in items], "nextCursor": cursor}

    def get_download(self, user: User, file_id: str) -> dict:
        item = self._repo.increment_downloads(file_id)
        if item is None:  # unknown, deleted, or upload never confirmed
            raise not_found()
        self._emit("FilesDownloaded")
        url = self._storage.presign_download(item["s3Key"], item["fileName"], self._settings.download_url_ttl)
        return {"url": url, "fileName": item["fileName"], "downloadCount": item["downloadCount"]}

    def delete_file(self, user: User, file_id: str) -> None:
        item = self._repo.get(file_id)
        if item is None:
            raise not_found()
        if item["uploaderId"] != user.id and not user.is_admin:
            raise ApiError(403, "forbidden", "Only the uploader or an admin can delete this file.")
        # Metadata first: if the second step fails we are left with an unlisted
        # object (costs a little storage) rather than a listed file that 404s.
        self._repo.delete(file_id)
        self._storage.delete(item.get("s3Key") or _pending_key(file_id))
        self._emit("FilesDeleted")

    def stats(self) -> dict:
        """Totals for the admin dashboard. Reads every ACTIVE item: fine at campus scale."""
        files = list(self._repo.iter_active())
        by_subject, downloads_by_subject = Counter(), Counter()
        by_type, by_semester = Counter(), Counter()
        for item in files:
            by_subject[item["subjectCode"]] += 1
            downloads_by_subject[item["subjectCode"]] += item["downloadCount"]
            by_type[item["resourceType"]] += 1
            by_semester[item["semester"]] += 1

        def brief(item: dict) -> dict:
            return {field: item[field] for field in _BRIEF_FIELDS}

        downloaded = [item for item in files if item["downloadCount"] > 0]
        return {
            "totals": {
                "files": len(files),
                "bytes": sum(item["size"] for item in files),
                "downloads": sum(item["downloadCount"] for item in files),
                "uploaders": len({item["uploaderId"] for item in files}),
            },
            "bySubject": [
                {"subjectCode": code, "files": count, "downloads": downloads_by_subject[code]}
                for code, count in sorted(by_subject.items(), key=lambda pair: (-pair[1], pair[0]))[:_TOP_SUBJECTS]
            ],
            "byType": [
                {"resourceType": name, "files": count}
                for name, count in sorted(by_type.items(), key=lambda pair: (-pair[1], pair[0]))
            ],
            "bySemester": [{"semester": n, "files": count} for n, count in sorted(by_semester.items())],
            "topDownloads": [
                brief(item) for item in sorted(downloaded, key=lambda i: (-i["downloadCount"], i["createdAt"]))[:_TOP_FILES]
            ],
            "recentUploads": [brief(item) for item in sorted(files, key=lambda i: i["createdAt"], reverse=True)[:_TOP_FILES]],
        }
