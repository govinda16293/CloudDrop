import pytest

from clouddrop.errors import ApiError
from clouddrop.validation import (
    ALLOWED_EXTENSIONS,
    RESOURCE_TYPES,
    parse_list_params,
    validate_upload,
)

MAX = 25 * 1024 * 1024


def payload(**overrides):
    base = {
        "title": "Unit 3 notes - Virtualization",
        "fileName": "unit3-virtualization.pdf",
        "size": 1_234_567,
        "subjectCode": "UCS531",
        "semester": 5,
        "resourceType": "notes",
        "tags": ["virtualization", "hypervisor"],
        "description": "Handwritten notes for unit 3.",
    }
    base.update(overrides)
    return base


def rejects(**overrides):
    with pytest.raises(ApiError) as caught:
        validate_upload(payload(**overrides), MAX)
    assert caught.value.status == 400
    assert caught.value.code == "validation_error"
    return caught.value.message


def test_valid_payload_is_returned_normalised():
    result = validate_upload(payload(), MAX)
    assert result == {
        "title": "Unit 3 notes - Virtualization",
        "fileName": "unit3-virtualization.pdf",
        "contentType": "application/pdf",
        "size": 1_234_567,
        "subjectCode": "UCS531",
        "semester": 5,
        "resourceType": "notes",
        "tags": ["virtualization", "hypervisor"],
        "description": "Handwritten notes for unit 3.",
    }


def test_subject_code_is_upper_cased_and_trimmed():
    assert validate_upload(payload(subjectCode=" ucs531 "), MAX)["subjectCode"] == "UCS531"


@pytest.mark.parametrize("code", ["", "531", "UCS", "UCS5311", "U531", "UCS-531", None, 531])
def test_bad_subject_code_is_rejected(code):
    assert "subject code" in rejects(subjectCode=code).lower()


@pytest.mark.parametrize("semester", [0, 9, -1, "five", None, 2.5, True, "²", "٣", "+3", " "])
def test_semester_outside_1_to_8_is_rejected(semester):
    assert "semester" in rejects(semester=semester).lower()


def test_semester_given_as_digit_string_is_accepted():
    assert validate_upload(payload(semester="7"), MAX)["semester"] == 7


def test_unknown_resource_type_is_rejected():
    assert "type" in rejects(resourceType="memes").lower()


@pytest.mark.parametrize("resource_type", RESOURCE_TYPES)
def test_every_known_resource_type_is_accepted(resource_type):
    assert validate_upload(payload(resourceType=resource_type), MAX)["resourceType"] == resource_type


@pytest.mark.parametrize("name", ["virus.exe", "page.html", "image.svg", "noextension", "script.js", ".pdf"])
def test_file_extension_not_on_the_allow_list_is_rejected(name):
    assert "file type" in rejects(fileName=name).lower()


def test_content_type_comes_from_the_extension_not_the_client():
    result = validate_upload(payload(fileName="Slides.PPTX", contentType="text/html"), MAX)
    assert result["contentType"] == ALLOWED_EXTENSIONS[".pptx"]


def test_directory_parts_are_stripped_from_file_name():
    assert validate_upload(payload(fileName="../../etc/notes.pdf"), MAX)["fileName"] == "notes.pdf"
    assert validate_upload(payload(fileName="C:\\Users\\me\\notes.pdf"), MAX)["fileName"] == "notes.pdf"


def test_unsafe_characters_in_file_name_are_replaced():
    result = validate_upload(payload(fileName='my "final" notes<1>.pdf'), MAX)
    assert result["fileName"] == "my _final_ notes_1_.pdf"


def test_overlong_file_name_keeps_its_extension():
    result = validate_upload(payload(fileName="a" * 300 + ".pdf"), MAX)
    assert len(result["fileName"]) <= 120
    assert result["fileName"].endswith(".pdf")


@pytest.mark.parametrize("size", [0, -5, MAX + 1, "12", None, 1.5, True])
def test_size_must_be_a_whole_number_within_the_limit(size):
    assert "size" in rejects(size=size).lower()


def test_size_exactly_at_the_limit_is_accepted():
    assert validate_upload(payload(size=MAX), MAX)["size"] == MAX


@pytest.mark.parametrize("title", ["", "  ", "ab", "x" * 121, None, 42])
def test_title_must_be_3_to_120_characters(title):
    assert "title" in rejects(title=title).lower()


def test_title_is_trimmed():
    assert validate_upload(payload(title="  Lab manual  "), MAX)["title"] == "Lab manual"


def test_tags_are_lower_cased_trimmed_and_de_duplicated():
    result = validate_upload(payload(tags=[" AWS ", "aws", "Lambda", ""]), MAX)
    assert result["tags"] == ["aws", "lambda"]


def test_more_than_8_tags_is_rejected():
    assert "tags" in rejects(tags=[f"tag{i}" for i in range(9)]).lower()


@pytest.mark.parametrize("tags", ["aws", [1, 2], [["nested"]], ["x" * 25], ["<script>"]])
def test_malformed_tags_are_rejected(tags):
    assert "tag" in rejects(tags=tags).lower()


def test_tags_and_description_are_optional():
    data = payload()
    del data["tags"], data["description"]
    result = validate_upload(data, MAX)
    assert result["tags"] == []
    assert result["description"] == ""


def test_description_over_500_characters_is_rejected():
    assert "description" in rejects(description="x" * 501).lower()


@pytest.mark.parametrize("body", [None, [], "text", 3])
def test_non_object_payload_is_rejected(body):
    with pytest.raises(ApiError) as caught:
        validate_upload(body, MAX)
    assert caught.value.status == 400


# ---- list params -----------------------------------------------------------


def test_list_params_default_when_nothing_is_given():
    assert parse_list_params(None) == {
        "subject": None,
        "semester": None,
        "resource_type": None,
        "q": None,
        "mine": False,
        "limit": 20,
        "cursor": None,
    }


def test_list_params_are_normalised():
    result = parse_list_params(
        {"subject": "ucs531", "semester": "5", "type": "notes", "q": "  Hyper Visor ", "mine": "1", "limit": "10", "cursor": "abc"}
    )
    assert result == {
        "subject": "UCS531",
        "semester": 5,
        "resource_type": "notes",
        "q": "hyper visor",
        "mine": True,
        "limit": 10,
        "cursor": "abc",
    }


@pytest.mark.parametrize("raw,expected", [("0", 1), ("-3", 1), ("51", 50), ("1000", 50), ("50", 50)])
def test_limit_is_clamped_to_1_to_50(raw, expected):
    assert parse_list_params({"limit": raw})["limit"] == expected


@pytest.mark.parametrize(
    "params",
    [{"limit": "ten"}, {"subject": "not-a-code"}, {"semester": "12"}, {"semester": "²"}, {"type": "memes"}, {"q": "x" * 61}],
)
def test_bad_list_params_are_rejected(params):
    with pytest.raises(ApiError) as caught:
        parse_list_params(params)
    assert caught.value.status == 400


def test_empty_strings_in_list_params_mean_not_set():
    result = parse_list_params({"subject": "", "semester": "", "type": "", "q": "  ", "mine": ""})
    assert result["subject"] is None and result["semester"] is None
    assert result["resource_type"] is None and result["q"] is None and result["mine"] is False
