"""Turn an API Gateway (REST, Lambda proxy) event into a call and a response."""

import base64
import binascii
import json
import os
import re
import traceback

from .config import DEFAULT_EMAIL_DOMAIN
from .errors import ApiError, not_found
from .service import User
from .validation import is_allowed_email

ADMIN_GROUP = "admins"
MAX_NAME_LENGTH = 60

# no-store: one CloudFront distribution fronts this API, and its cache key does
# not include the Authorization header. Nothing here may ever be cached.
_HEADERS = {"Content-Type": "application/json", "Cache-Control": "no-store"}
_FILE_ID = re.compile(r"^[0-9a-f]{32}$")


def json_response(status: int, body) -> dict:
    return {"statusCode": status, "headers": dict(_HEADERS), "body": json.dumps(body)}


def _error_response(status: int, code: str, message: str) -> dict:
    return json_response(status, {"error": {"code": code, "message": message}})


def parse_json_body(event: dict):
    body = event.get("body")
    try:
        if body and event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        return json.loads(body)
    except (TypeError, ValueError, binascii.Error):
        raise ApiError(400, "bad_request", "Request body must be valid JSON.") from None


def file_id_from(event: dict) -> str:
    file_id = (event.get("pathParameters") or {}).get("id") or ""
    if not _FILE_ID.match(file_id):
        raise not_found()
    return file_id


def _groups(raw) -> set[str]:
    """Cognito's group claim reaches Lambda as a list, as "a,b" or as "[a, b]"."""
    if isinstance(raw, list):
        return {str(group) for group in raw}
    if isinstance(raw, str):
        return {group for group in re.split(r"[,\s]+", raw.strip("[] ")) if group}
    return set()


def user_from_event(event: dict) -> User:
    """Identity comes only from claims API Gateway verified, never from the request body."""
    claims = ((event.get("requestContext") or {}).get("authorizer") or {}).get("claims") or {}
    if not claims.get("sub"):
        raise ApiError(401, "unauthorized", "Sign in to continue.")
    email = str(claims.get("email") or "").strip().lower()
    # The sign-up trigger checks the domain once. A signed-in user can later
    # change their own e-mail attribute in Cognito, so check on every request
    # that the address is still a proven college one.
    domain = os.environ.get("ALLOWED_EMAIL_DOMAIN", DEFAULT_EMAIL_DOMAIN)
    if claims.get("email_verified") not in (True, "true") or not is_allowed_email(email, domain):
        raise ApiError(403, "forbidden", f"CloudDrop needs a verified @{domain} e-mail address.")
    name = str(claims.get("name") or "").strip() or email.partition("@")[0] or "Student"
    return User(
        id=str(claims["sub"]),
        email=email,
        name=name[:MAX_NAME_LENGTH],
        is_admin=ADMIN_GROUP in _groups(claims.get("cognito:groups")),
    )


def dispatch(routes: dict, event: dict) -> dict:
    """routes maps (HTTP method, API Gateway resource) to fn(user, event) -> (status, body)."""
    try:
        route = routes.get((event.get("httpMethod"), event.get("resource")))
        if route is None:
            raise ApiError(404, "not_found", "No such route.")
        status, body = route(user_from_event(event), event)
        return json_response(status, body)
    except ApiError as error:
        return _error_response(error.status, error.code, error.message)
    except Exception:  # noqa: BLE001 - last line of defence; details go to the log only
        print(json.dumps({"level": "ERROR", "message": "unhandled error", "trace": traceback.format_exc()}))
        return _error_response(500, "internal_error", "Something went wrong. Please try again.")
