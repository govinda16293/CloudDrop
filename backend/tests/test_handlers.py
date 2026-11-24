import base64
import json
from pathlib import Path

import pytest

from clouddrop.handlers import admin as admin_handler
from clouddrop.handlers import files as files_handler
from clouddrop.handlers import presignup
from helpers import PDF, api_event, browser_upload, claims_for, upload_payload

FILE = "/api/files/{id}"


def call(handler, *args, **kwargs):
    response = handler.handler(api_event(*args, **kwargs), None)
    body = json.loads(response["body"]) if response["body"] else None
    return response["statusCode"], body, response


def share(user, **overrides):
    claims = claims_for(user)
    status, created, _ = call(files_handler, "POST", "/api/files", claims, body=upload_payload(**overrides))
    assert status == 201, created
    browser_upload(created["upload"])
    file_id = created["file"]["fileId"]
    status, file, _ = call(files_handler, "POST", FILE + "/complete", claims, path={"id": file_id})
    assert status == 200, file
    return file


def test_whole_journey_through_the_api(lambda_env, asha, ravi):
    file = share(asha, title="Unit 3 notes")
    file_id = file["fileId"]

    status, listing, _ = call(files_handler, "GET", "/api/files", claims_for(ravi), query={"subject": "UCS531"})
    assert status == 200 and [f["fileId"] for f in listing["items"]] == [file_id]
    assert listing["nextCursor"] is None

    status, fetched, _ = call(files_handler, "GET", FILE, claims_for(ravi), path={"id": file_id})
    assert status == 200 and fetched["title"] == "Unit 3 notes" and fetched["canDelete"] is False

    status, download, _ = call(files_handler, "GET", FILE + "/download", claims_for(ravi), path={"id": file_id})
    assert status == 200 and download["downloadCount"] == 1 and download["url"].startswith("https://")

    status, body, _ = call(files_handler, "DELETE", FILE, claims_for(ravi), path={"id": file_id})
    assert status == 403 and body["error"]["code"] == "forbidden"

    status, body, _ = call(files_handler, "DELETE", FILE, claims_for(asha), path={"id": file_id})
    assert status == 200 and body == {"deleted": True}

    status, body, _ = call(files_handler, "GET", FILE, claims_for(asha), path={"id": file_id})
    assert status == 404 and body["error"]["code"] == "not_found"


def test_me_returns_the_user_and_the_upload_rules(lambda_env, asha):
    status, body, _ = call(files_handler, "GET", "/api/me", claims_for(asha))
    assert status == 200
    assert body["user"] == {"id": asha.id, "email": asha.email, "name": "Asha", "isAdmin": False}
    assert body["limits"]["maxFileBytes"] == 1024 * 1024


def test_name_falls_back_to_the_email_local_part(lambda_env, asha):
    claims = claims_for(asha)
    del claims["name"]
    _, body, _ = call(files_handler, "GET", "/api/me", claims)
    assert body["user"]["name"] == "asha_be24"


@pytest.mark.parametrize("groups", [["admins"], "admins", "students,admins", "[students, admins]"])
def test_admin_group_is_recognised_in_every_shape_cognito_sends(lambda_env, asha, groups):
    _, body, _ = call(files_handler, "GET", "/api/me", claims_for(asha, groups=groups))
    assert body["user"]["isAdmin"] is True


@pytest.mark.parametrize("groups", [None, "", "students", ["students"], "notadmins", "admins2"])
def test_other_groups_do_not_make_an_admin(lambda_env, asha, groups):
    _, body, _ = call(files_handler, "GET", "/api/me", claims_for(asha, groups=groups))
    assert body["user"]["isAdmin"] is False


def test_request_without_claims_is_a_401(lambda_env):
    for claims in (None, {}, {"email": "x@thapar.edu"}):
        status, body, _ = call(files_handler, "GET", "/api/files", claims)
        assert status == 401 and body["error"]["code"] == "unauthorized"


@pytest.mark.parametrize("verified", ["false", False, None, "", "TRUE "])
def test_unverified_email_is_refused(lambda_env, asha, verified):
    # A signed-in user can change their own e-mail attribute in Cognito. Until
    # they prove the new address, the token says email_verified = false.
    claims = claims_for(asha)
    claims["email_verified"] = verified
    status, body, _ = call(files_handler, "GET", "/api/files", claims)
    assert status == 403 and body["error"]["code"] == "forbidden"


def test_verified_flag_is_accepted_as_string_or_boolean(lambda_env, asha):
    for verified in ("true", True):
        claims = claims_for(asha)
        claims["email_verified"] = verified
        assert call(files_handler, "GET", "/api/me", claims)[0] == 200


@pytest.mark.parametrize("email", ["asha@gmail.com", "asha@mail.thapar.edu", "asha@thapar.edu.evil.com", ""])
def test_email_outside_the_college_domain_is_refused_even_with_a_valid_token(lambda_env, asha, email):
    claims = claims_for(asha)
    claims["email"] = email
    status, body, _ = call(files_handler, "POST", "/api/files", claims, body=upload_payload())
    assert status == 403 and "thapar.edu" in body["error"]["message"]


def test_unknown_route_is_a_404(lambda_env, asha):
    status, body, _ = call(files_handler, "PUT", "/api/files", claims_for(asha))
    assert status == 404 and body["error"]["code"] == "not_found"


def test_bad_json_body_is_a_400(lambda_env, asha):
    status, body, _ = call(files_handler, "POST", "/api/files", claims_for(asha), body="{not json")
    assert status == 400 and body["error"]["code"] == "bad_request"


def test_missing_body_is_a_400(lambda_env, asha):
    status, _, _ = call(files_handler, "POST", "/api/files", claims_for(asha), body=None)
    assert status == 400


def test_base64_encoded_body_is_decoded(lambda_env, asha):
    event = api_event("POST", "/api/files", claims_for(asha))
    event["body"] = base64.b64encode(json.dumps(upload_payload()).encode()).decode()
    event["isBase64Encoded"] = True
    assert files_handler.handler(event, None)["statusCode"] == 201


def test_validation_message_reaches_the_client(lambda_env, asha):
    status, body, _ = call(files_handler, "POST", "/api/files", claims_for(asha), body=upload_payload(semester=12))
    assert status == 400 and body["error"] == {
        "code": "validation_error",
        "message": "Semester must be a whole number from 1 to 8.",
    }


@pytest.mark.parametrize("file_id", ["../etc/passwd", "x" * 32, "ABCDEF" + "0" * 26, "", "0" * 31])
def test_malformed_file_id_is_a_404_without_touching_the_database(lambda_env, asha, file_id):
    status, body, _ = call(files_handler, "GET", FILE, claims_for(asha), path={"id": file_id})
    assert status == 404 and body["error"]["code"] == "not_found"


def test_every_response_forbids_caching_and_is_json(lambda_env, asha):
    for response in (
        call(files_handler, "GET", "/api/files", claims_for(asha))[2],
        call(files_handler, "GET", "/api/files", None)[2],
        call(files_handler, "GET", FILE, claims_for(asha), path={"id": "0" * 32})[2],
    ):
        assert response["headers"]["Cache-Control"] == "no-store"
        assert response["headers"]["Content-Type"] == "application/json"


def test_unexpected_error_is_a_500_that_leaks_nothing(lambda_env, asha, monkeypatch, capsys):
    def explode(*args, **kwargs):
        raise RuntimeError("secret table name clouddrop-prod-files")

    from clouddrop.service import FileService

    monkeypatch.setattr(FileService, "list_files", explode)
    status, body, _ = call(files_handler, "GET", "/api/files", claims_for(asha))
    assert status == 500
    assert body == {"error": {"code": "internal_error", "message": "Something went wrong. Please try again."}}
    assert "secret table name" in capsys.readouterr().out  # but it is in the log


# ---- admin ----------------------------------------------------------------


def test_admin_stats_for_an_admin(lambda_env, asha, admin):
    share(asha)
    status, body, _ = call(admin_handler, "GET", "/api/admin/stats", claims_for(admin, groups="admins"))
    assert status == 200
    assert body["totals"]["files"] == 1 and body["totals"]["bytes"] == len(PDF)
    assert body["platform"]["available"] is True
    assert body["generatedAt"].endswith("Z")


def test_admin_stats_is_forbidden_for_a_student(lambda_env, asha):
    status, body, _ = call(admin_handler, "GET", "/api/admin/stats", claims_for(asha))
    assert status == 403 and body["error"]["code"] == "forbidden"


def test_admin_stats_without_claims_is_a_401(lambda_env):
    assert call(admin_handler, "GET", "/api/admin/stats", None)[0] == 401


# ---- pre sign-up ----------------------------------------------------------


def signup_event(email):
    return {"triggerSource": "PreSignUp_SignUp", "request": {"userAttributes": {"email": email}}, "response": {}}


@pytest.mark.parametrize("email", ["asha_be24@thapar.edu", "ASHA@Thapar.EDU", " ravi@thapar.edu "])
def test_presignup_accepts_institute_addresses(monkeypatch, email):
    monkeypatch.setenv("ALLOWED_EMAIL_DOMAIN", "thapar.edu")
    event = signup_event(email)
    assert presignup.handler(event, None) is event


@pytest.mark.parametrize(
    "email",
    [
        "someone@gmail.com",
        "x@evilthapar.edu",
        "x@thapar.edu.evil.com",
        "x@mail.thapar.edu",
        "x@thapar.edu@gmail.com",
        "@thapar.edu",
        "thapar.edu",
        "",
        None,
    ],
)
def test_presignup_rejects_everything_else(monkeypatch, email):
    monkeypatch.setenv("ALLOWED_EMAIL_DOMAIN", "thapar.edu")
    with pytest.raises(Exception, match="@thapar.edu"):
        presignup.handler(signup_event(email), None)


def test_presignup_domain_comes_from_configuration(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAIL_DOMAIN", "example.ac.in")
    assert presignup.handler(signup_event("a@example.ac.in"), None)
    with pytest.raises(Exception):
        presignup.handler(signup_event("a@thapar.edu"), None)


# ---- packaging ------------------------------------------------------------


def test_lambda_source_never_imports_local_mode_or_test_tools():
    source = Path(__file__).resolve().parent.parent / "src"
    for path in source.rglob("*.py"):
        text = path.read_text()
        for forbidden in ("import moto", "from moto", "from local", "import local", "import requests", "import yaml"):
            assert forbidden not in text, f"{path.name} contains '{forbidden}'"
