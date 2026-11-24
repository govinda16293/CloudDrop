import pytest

from clouddrop.errors import ApiError
from helpers import make_item


def add_active(repo, file_id, **overrides):
    repo.put_pending(make_item(file_id, **overrides))
    return repo.activate(file_id, f"files/{file_id}", overrides.get("size", 1000))


def ids(items):
    return [item["fileId"] for item in items]


def test_get_returns_none_for_unknown_id(repo):
    assert repo.get("nope") is None


def test_put_pending_then_get_round_trips_with_plain_numbers(repo):
    repo.put_pending(make_item("f1"))
    item = repo.get("f1")
    assert item["status"] == "PENDING"
    assert item["size"] == 1000 and type(item["size"]) is int
    assert type(item["semester"]) is int


def test_put_pending_refuses_to_overwrite_an_existing_id(repo):
    repo.put_pending(make_item("f1"))
    with pytest.raises(ApiError) as caught:
        repo.put_pending(make_item("f1", title="other"))
    assert caught.value.status == 409


def test_pending_items_are_not_listed_anywhere(repo):
    repo.put_pending(make_item("f1"))
    assert repo.list_files()[0] == []
    assert repo.list_files(subject="UCS531")[0] == []
    assert repo.list_files(uploader_id="user-1")[0] == []
    assert list(repo.iter_active()) == []


def test_activate_makes_the_item_listed_and_records_real_size_and_key(repo):
    repo.put_pending(make_item("f1", size=1000))
    item = repo.activate("f1", "files/f1", 987)
    assert item["status"] == "ACTIVE" and item["size"] == 987 and item["s3Key"] == "files/f1"
    assert ids(repo.list_files()[0]) == ["f1"]
    assert ids(repo.list_files(subject="UCS531")[0]) == ["f1"]
    assert ids(repo.list_files(uploader_id="user-1")[0]) == ["f1"]


def test_activate_removes_the_expiry_so_ttl_never_deletes_a_live_file(repo):
    repo.put_pending(make_item("f1", expiresAt=1_800_000_000))
    repo.activate("f1", "files/f1", 1000)
    assert "expiresAt" not in repo.get("f1")


def test_activate_a_second_time_returns_none_and_changes_nothing(repo):
    add_active(repo, "f1")
    assert repo.activate("f1", "files/other", 5) is None
    assert repo.get("f1")["s3Key"] == "files/f1"


def test_activate_unknown_id_returns_none(repo):
    assert repo.activate("ghost", "files/ghost", 1) is None
    assert repo.get("ghost") is None


def test_listing_is_newest_first(repo):
    add_active(repo, "old", createdAt="2026-11-01T00:00:00.000000Z")
    add_active(repo, "new", createdAt="2026-11-20T00:00:00.000000Z")
    add_active(repo, "mid", createdAt="2026-11-10T00:00:00.000000Z")
    assert ids(repo.list_files()[0]) == ["new", "mid", "old"]


@pytest.fixture
def library(repo):
    add_active(repo, "a", subjectCode="UCS531", semester=5, resourceType="notes", uploaderId="u1",
               searchText="cloud notes unit 1 ucs531 virtualization", createdAt="2026-11-01T00:00:00.000000Z")
    add_active(repo, "b", subjectCode="UCS531", semester=5, resourceType="slides", uploaderId="u2",
               searchText="cloud slides ucs531 serverless lambda", createdAt="2026-11-02T00:00:00.000000Z")
    add_active(repo, "c", subjectCode="UMA010", semester=1, resourceType="notes", uploaderId="u1",
               searchText="maths notes uma010 calculus", createdAt="2026-11-03T00:00:00.000000Z")
    add_active(repo, "d", subjectCode="UCS531", semester=6, resourceType="question-paper", uploaderId="u1",
               searchText="cloud est paper ucs531 lambda", createdAt="2026-11-04T00:00:00.000000Z")
    return repo


def test_filter_by_subject(library):
    assert ids(library.list_files(subject="UCS531")[0]) == ["d", "b", "a"]


def test_filter_by_semester(library):
    assert ids(library.list_files(semester=5)[0]) == ["b", "a"]


def test_filter_by_resource_type(library):
    assert ids(library.list_files(resource_type="notes")[0]) == ["c", "a"]


def test_filter_by_uploader(library):
    assert ids(library.list_files(uploader_id="u1")[0]) == ["d", "c", "a"]


def test_filters_combine(library):
    assert ids(library.list_files(subject="UCS531", uploader_id="u1", semester=5)[0]) == ["a"]
    assert ids(library.list_files(subject="UCS531", resource_type="slides")[0]) == ["b"]


def test_text_search_needs_every_word_to_match(library):
    assert ids(library.list_files(q="lambda")[0]) == ["d", "b"]
    assert ids(library.list_files(q="cloud lambda paper")[0]) == ["d"]
    assert ids(library.list_files(q="quantum")[0]) == []


def test_text_search_combines_with_subject(library):
    assert ids(library.list_files(subject="UMA010", q="notes")[0]) == ["c"]


def many(repo, count, **overrides):
    for n in range(count):
        add_active(repo, f"f{n:03d}", createdAt=f"2026-11-01T00:{n // 60:02d}:{n % 60:02d}.000000Z", **overrides)


def walk(repo, **query):
    """Follow cursors to the end; return the ids of every page."""
    pages, cursor = [], None
    for _ in range(100):
        items, cursor = repo.list_files(cursor=cursor, **query)
        pages.append(ids(items))
        if cursor is None:
            return pages
    raise AssertionError("cursor never ended")


def test_pagination_returns_every_item_once_in_order(repo):
    many(repo, 25)
    pages = walk(repo, limit=10)
    assert [len(p) for p in pages] == [10, 10, 5]
    seen = [i for page in pages for i in page]
    assert seen == sorted(seen, reverse=True) and len(set(seen)) == 25


def test_no_cursor_when_the_last_page_is_exactly_full(repo):
    many(repo, 10)
    items, cursor = repo.list_files(limit=10)
    assert len(items) == 10 and cursor is None


def test_pagination_with_a_filter_fills_pages_and_skips_nothing(repo):
    # Only every third item matches, so one DynamoDB page holds fewer matches
    # than it scanned. The cursor must follow the last item *returned*.
    for n in range(30):
        add_active(repo, f"f{n:03d}", createdAt=f"2026-11-01T00:00:{n:02d}.000000Z",
                   semester=5 if n % 3 == 0 else 2)
    pages = walk(repo, semester=5, limit=4)
    assert [len(p) for p in pages] == [4, 4, 2]
    assert [i for page in pages for i in page] == [f"f{n:03d}" for n in range(27, -1, -3)]


def test_pagination_works_on_the_subject_and_uploader_indexes(repo):
    many(repo, 7, subjectCode="UCS531", uploaderId="u9")
    assert sum(len(p) for p in walk(repo, subject="UCS531", limit=3)) == 7
    assert sum(len(p) for p in walk(repo, uploader_id="u9", limit=3)) == 7


@pytest.mark.parametrize("cursor", ["not-base64!", "e30", "W10", "eyJmaWxlSWQiOiAxfQ"])
def test_malformed_cursor_is_a_400(repo, cursor):
    many(repo, 3)
    with pytest.raises(ApiError) as caught:
        repo.list_files(cursor=cursor)
    assert caught.value.status == 400 and caught.value.code == "bad_cursor"


def test_cursor_from_one_listing_is_rejected_on_another(repo):
    many(repo, 5, subjectCode="UCS531")
    _, cursor = repo.list_files(subject="UCS531", limit=2)
    with pytest.raises(ApiError) as caught:
        repo.list_files(uploader_id="user-1", cursor=cursor)
    assert caught.value.status == 400


def test_increment_downloads_counts_up_from_zero(repo):
    add_active(repo, "f1")
    assert repo.increment_downloads("f1")["downloadCount"] == 1
    updated = repo.increment_downloads("f1")
    assert updated["downloadCount"] == 2 and updated["s3Key"] == "files/f1" and updated["fileName"] == "unit3.pdf"
    assert repo.get("f1")["downloadCount"] == 2


def test_increment_downloads_refuses_pending_and_unknown_files(repo):
    repo.put_pending(make_item("f1"))
    assert repo.increment_downloads("f1") is None
    assert repo.increment_downloads("ghost") is None
    assert repo.get("f1")["downloadCount"] == 0 and repo.get("ghost") is None


def test_delete_removes_the_item_from_table_and_listings(repo):
    add_active(repo, "f1")
    repo.delete("f1")
    assert repo.get("f1") is None and repo.list_files()[0] == []


def test_iter_active_yields_every_active_item(repo):
    many(repo, 130)
    repo.put_pending(make_item("pending"))
    assert len(list(repo.iter_active())) == 130


def test_count_by_uploader_counts_only_that_users_active_files(repo):
    many(repo, 120, uploaderId="u1")
    add_active(repo, "other", uploaderId="u2")
    repo.put_pending(make_item("pending", uploaderId="u1"))
    assert repo.count_by_uploader("u1") == 120
    assert repo.count_by_uploader("u2") == 1
    assert repo.count_by_uploader("nobody") == 0
