"""Validate and normalise what the browser sends. No AWS calls in here."""

import re

from .errors import ApiError

RESOURCE_TYPES = ("notes", "lab-manual", "question-paper", "slides", "project", "other")

# The content type is taken from this table, never from the client, so an
# uploaded file can not claim to be HTML or SVG and run script in a browser.
ALLOWED_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".zip": "application/zip",
    ".ipynb": "application/x-ipynb+json",
}

MIN_TITLE_LENGTH = 3
MAX_TITLE_LENGTH = 120
MAX_TAGS = 8
MAX_TAG_LENGTH = 24
MAX_FILE_NAME_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 500
MAX_QUERY_LENGTH = 60
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50

_SUBJECT_CODE = re.compile(r"^[A-Z]{2,4}[0-9]{3}$")
_TAG = re.compile(r"^[a-z0-9][a-z0-9 +#.\-]*$")
_UNSAFE_FILE_CHARS = re.compile(r"[^A-Za-z0-9._() \-]")


def _invalid(message: str) -> ApiError:
    return ApiError(400, "validation_error", message)


def _subject_code(value) -> str:
    code = value.strip().upper() if isinstance(value, str) else ""
    if not _SUBJECT_CODE.match(code):
        raise _invalid("Subject code must look like UCS531 (2-4 letters then 3 digits).")
    return code


def _semester(value) -> int:
    # ASCII digits only: str.isdigit() also accepts characters such as "²" that int() rejects.
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value.strip()):
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 8:
        raise _invalid("Semester must be a whole number from 1 to 8.")
    return value


def _resource_type(value) -> str:
    if value not in RESOURCE_TYPES:
        raise _invalid("Resource type must be one of: " + ", ".join(RESOURCE_TYPES) + ".")
    return value


def _title(value) -> str:
    title = value.strip() if isinstance(value, str) else ""
    if not MIN_TITLE_LENGTH <= len(title) <= MAX_TITLE_LENGTH:
        raise _invalid(f"Title must be {MIN_TITLE_LENGTH} to {MAX_TITLE_LENGTH} characters.")
    return title


def _file_name(value) -> tuple[str, str]:
    """Return (safe file name, content type)."""
    raw = value if isinstance(value, str) else ""
    name = _UNSAFE_FILE_CHARS.sub("_", re.split(r"[\\/]", raw)[-1].strip())
    stem, dot, extension = name.rpartition(".")
    extension = (dot + extension).lower()
    if not stem.strip(". ") or extension not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise _invalid(f"This file type is not allowed. Allowed: {allowed}.")
    stem = stem[: MAX_FILE_NAME_LENGTH - len(extension)]
    return stem + extension, ALLOWED_EXTENSIONS[extension]


def _size(value, max_bytes: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= max_bytes:
        limit_mb = max_bytes // (1024 * 1024)
        raise _invalid(f"File size must be between 1 byte and {limit_mb} MB.")
    return value


def _tags(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(tag, str) for tag in value):
        raise _invalid("Tags must be a list of short words.")
    tags: list[str] = []
    for raw in value:
        tag = raw.strip().lower()
        if not tag or tag in tags:
            continue
        if len(tag) > MAX_TAG_LENGTH or not _TAG.match(tag):
            raise _invalid(f"Each tag must be at most {MAX_TAG_LENGTH} letters, digits, spaces or + # . -")
        tags.append(tag)
    if len(tags) > MAX_TAGS:
        raise _invalid(f"At most {MAX_TAGS} tags are allowed.")
    return tags


def _description(value) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value.strip()) > MAX_DESCRIPTION_LENGTH:
        raise _invalid(f"Description must be text of at most {MAX_DESCRIPTION_LENGTH} characters.")
    return value.strip()


def validate_upload(payload, max_bytes: int) -> dict:
    if not isinstance(payload, dict):
        raise _invalid("Request body must be a JSON object.")
    file_name, content_type = _file_name(payload.get("fileName"))
    return {
        "title": _title(payload.get("title")),
        "fileName": file_name,
        "contentType": content_type,
        "size": _size(payload.get("size"), max_bytes),
        "subjectCode": _subject_code(payload.get("subjectCode")),
        "semester": _semester(payload.get("semester")),
        "resourceType": _resource_type(payload.get("resourceType")),
        "tags": _tags(payload.get("tags")),
        "description": _description(payload.get("description")),
    }


def parse_list_params(params) -> dict:
    """Query-string values arrive as strings; empty string means 'not set'."""
    params = params or {}

    def given(name: str):
        value = (params.get(name) or "").strip()
        return value or None

    limit = given("limit")
    if limit is not None and not re.fullmatch(r"-?[0-9]+", limit):
        raise _invalid("Limit must be a number.")
    query = given("q")
    if query is not None and len(query) > MAX_QUERY_LENGTH:
        raise _invalid(f"Search text must be at most {MAX_QUERY_LENGTH} characters.")

    subject, semester, resource_type = given("subject"), given("semester"), given("type")
    return {
        "subject": _subject_code(subject) if subject else None,
        "semester": _semester(semester) if semester else None,
        "resource_type": _resource_type(resource_type) if resource_type else None,
        "q": " ".join(query.lower().split()) if query else None,
        "mine": (given("mine") or "").lower() in ("1", "true"),
        "limit": DEFAULT_PAGE_SIZE if limit is None else max(1, min(MAX_PAGE_SIZE, int(limit))),
        "cursor": given("cursor"),
    }


def is_allowed_email(email, domain: str) -> bool:
    """True only for name@<domain> exactly: no sub-domains, no look-alikes."""
    if not isinstance(email, str):
        return False
    local, at, host = email.strip().lower().partition("@")
    return bool(local) and bool(at) and host == domain.lower()
