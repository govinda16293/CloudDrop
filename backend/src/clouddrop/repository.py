"""DynamoDB access for file metadata. The only module that talks to the table.

Item life cycle:

    put_pending()            activate()
  ----------------> PENDING -----------> ACTIVE ----> delete()
                       |
                       +--> removed by DynamoDB TTL (expiresAt) if never confirmed

The three index key attributes (gsiAll, gsiSubject, gsiUploader) are written
only by activate(). The indexes are therefore "sparse": a PENDING item is in
none of them and can not show up in any listing.
"""

import base64
import binascii
import json
from decimal import Decimal

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from .errors import ApiError, aws_error_code

ACTIVE = "ACTIVE"
PENDING = "PENDING"

_RECENT_INDEX = "byRecent"
_RECENT_KEY = "gsiAll"
_ALL = "ALL"  # the single partition of the byRecent index
_SCAN_PAGE = 100  # items DynamoDB reads per request while filtering
_MAX_SCAN_PAGES = 10  # upper bound on work for one API call
_MAX_SEARCH_WORDS = 5


def _plain(value):
    """DynamoDB hands numbers back as Decimal; the rest of the code wants int."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def _bad_cursor() -> ApiError:
    return ApiError(400, "bad_cursor", "This page link is no longer valid. Start the search again.")


def _encode_cursor(key: dict) -> str:
    raw = json.dumps(key, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str, partition_attr: str, partition_value: str) -> dict:
    """A cursor is client-supplied, so accept only the exact shape we issue."""
    try:
        key = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise _bad_cursor() from None
    expected = {"fileId", "createdAt", partition_attr}
    if not isinstance(key, dict) or set(key) != expected or not all(isinstance(v, str) for v in key.values()):
        raise _bad_cursor()
    if key[partition_attr] != partition_value:
        raise _bad_cursor()
    return key


class FileRepository:
    def __init__(self, table):
        self._table = table

    def put_pending(self, item: dict) -> None:
        try:
            self._table.put_item(Item=item, ConditionExpression="attribute_not_exists(fileId)")
        except ClientError as error:
            if aws_error_code(error) == "ConditionalCheckFailedException":
                raise ApiError(409, "conflict", "That file id is already in use. Try again.") from None
            raise

    def get(self, file_id: str) -> dict | None:
        item = self._table.get_item(Key={"fileId": file_id}, ConsistentRead=True).get("Item")
        return _plain(item) if item else None

    def activate(self, file_id: str, s3_key: str, size: int) -> dict | None:
        """PENDING -> ACTIVE. Returns the item, or None if it was not PENDING."""
        try:
            response = self._table.update_item(
                Key={"fileId": file_id},
                UpdateExpression=(
                    "SET #status = :active, s3Key = :key, #size = :size, "
                    "gsiAll = :all, gsiSubject = subjectCode, gsiUploader = uploaderId "
                    "REMOVE expiresAt"
                ),
                ConditionExpression="#status = :pending",
                ExpressionAttributeNames={"#status": "status", "#size": "size"},
                ExpressionAttributeValues={
                    ":active": ACTIVE,
                    ":pending": PENDING,
                    ":key": s3_key,
                    ":size": size,
                    ":all": _ALL,
                },
                ReturnValues="ALL_NEW",
            )
        except ClientError as error:
            if aws_error_code(error) == "ConditionalCheckFailedException":
                return None
            raise
        return _plain(response["Attributes"])

    def list_files(
        self,
        *,
        subject: str | None = None,
        uploader_id: str | None = None,
        semester: int | None = None,
        resource_type: str | None = None,
        q: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> tuple[list[dict], str | None]:
        """Newest first. Returns (items, cursor for the next page or None)."""
        filters = []
        if uploader_id:
            index, partition_attr, partition_value = "byUploader", "gsiUploader", uploader_id
            if subject:
                filters.append(Attr("subjectCode").eq(subject))
        elif subject:
            index, partition_attr, partition_value = "bySubject", "gsiSubject", subject
        else:
            index, partition_attr, partition_value = _RECENT_INDEX, _RECENT_KEY, _ALL
        if semester is not None:
            filters.append(Attr("semester").eq(semester))
        if resource_type:
            filters.append(Attr("resourceType").eq(resource_type))
        for word in (q or "").split()[:_MAX_SEARCH_WORDS]:
            filters.append(Attr("searchText").contains(word))

        query = {
            "IndexName": index,
            "KeyConditionExpression": Key(partition_attr).eq(partition_value),
            "ScanIndexForward": False,
            # With a filter DynamoDB reads items that will not be returned, so
            # read generously. Without one, every item read is returned: read
            # just the page plus one (the extra one tells us there is a next page).
            "Limit": _SCAN_PAGE if filters else limit + 1,
        }
        if filters:
            condition = filters[0]
            for extra in filters[1:]:
                condition = condition & extra
            query["FilterExpression"] = condition

        start = _decode_cursor(cursor, partition_attr, partition_value) if cursor else None
        matched: list[dict] = []
        for _ in range(_MAX_SCAN_PAGES):
            if start:
                query["ExclusiveStartKey"] = start
            try:
                response = self._table.query(**query)
            except ClientError as error:
                if cursor and aws_error_code(error) == "ValidationException":
                    raise _bad_cursor() from None
                raise
            matched.extend(response["Items"])
            start = response.get("LastEvaluatedKey")
            if len(matched) > limit or not start:
                break

        if len(matched) > limit:
            # DynamoDB's own LastEvaluatedKey marks where it stopped *reading*,
            # which is past items we are not returning. Point the cursor at the
            # last item actually returned instead.
            page = matched[:limit]
            last = page[-1]
            next_key = {"fileId": last["fileId"], "createdAt": last["createdAt"], partition_attr: partition_value}
            return _plain(page), _encode_cursor(next_key)
        return _plain(matched), _encode_cursor(_plain(start)) if start else None

    def increment_downloads(self, file_id: str) -> dict | None:
        """Atomic +1. Returns the updated item, or None if the file is not ACTIVE.

        The condition makes this one call both the "does it exist" check and
        the update, so a download needs no separate read."""
        try:
            response = self._table.update_item(
                Key={"fileId": file_id},
                UpdateExpression="ADD downloadCount :one",
                ConditionExpression="#status = :active",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={":one": 1, ":active": ACTIVE},
                ReturnValues="ALL_NEW",
            )
        except ClientError as error:
            if aws_error_code(error) == "ConditionalCheckFailedException":
                return None
            raise
        return _plain(response["Attributes"])

    def count_by_uploader(self, uploader_id: str) -> int:
        """How many ACTIVE files this user has. DynamoDB counts; no items are returned."""
        query = {
            "IndexName": "byUploader",
            "KeyConditionExpression": Key("gsiUploader").eq(uploader_id),
            "Select": "COUNT",
        }
        total = 0
        while True:
            response = self._table.query(**query)
            total += response["Count"]
            if "LastEvaluatedKey" not in response:
                return total
            query["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    def delete(self, file_id: str) -> None:
        self._table.delete_item(Key={"fileId": file_id})

    def iter_active(self):
        """Every ACTIVE item. Used by admin statistics only."""
        query = {"IndexName": _RECENT_INDEX, "KeyConditionExpression": Key(_RECENT_KEY).eq(_ALL)}
        while True:
            response = self._table.query(**query)
            yield from _plain(response["Items"])
            if "LastEvaluatedKey" not in response:
                return
            query["ExclusiveStartKey"] = response["LastEvaluatedKey"]
