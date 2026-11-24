"""Local mode over real HTTP sockets: the stand-in for API Gateway plus a mock
AWS server. This is also the only test where a pre-signed upload and download
travel over HTTP the way a browser sends them.
"""

import json
import socket
import urllib.error
import urllib.request

import pytest
import requests

from clouddrop.handlers import admin as admin_handler
from clouddrop.handlers import files as files_handler
from helpers import PDF, upload_payload
from local import server as local_server
from local.bootstrap import load_template


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def base_url():
    running = local_server.start(api_port=free_port(), mock_port=free_port())
    yield f"http://127.0.0.1:{running.api_port}"
    running.stop()


def token(email="asha_be24@thapar.edu", name="Asha", admin=False):
    return local_server.make_local_token(email, name, admin)


def http(base_url, method, path, auth=None, body=None):
    request = urllib.request.Request(base_url + path, method=method)
    if auth:
        request.add_header("Authorization", auth)
    data = json.dumps(body).encode() if body is not None else None
    if data:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, data=data, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_handler_routes_match_the_template_exactly():
    resources = load_template()["Resources"]
    for function, handler in (("FilesFunction", files_handler), ("AdminFunction", admin_handler)):
        events = resources[function]["Properties"]["Events"].values()
        in_template = {(e["Properties"]["Method"].upper(), e["Properties"]["Path"]) for e in events}
        assert set(handler.ROUTES) == in_template, function


def test_request_without_a_token_is_rejected_like_api_gateway_does(base_url):
    assert http(base_url, "GET", "/api/files") == (401, {"message": "Unauthorized"})


@pytest.mark.parametrize("bad", ["garbage", "local.not-base64", "local.e30", "eyJhbGciOiJub25lIn0.e30."])
def test_malformed_token_is_rejected(base_url, bad):
    assert http(base_url, "GET", "/api/files", auth=bad)[0] == 401


def test_token_for_another_email_domain_is_rejected(base_url):
    status, body = http(base_url, "GET", "/api/files", auth=token(email="someone@gmail.com"))
    assert status == 403 and "thapar.edu" in body["message"]


def test_unknown_path_is_a_404(base_url):
    assert http(base_url, "GET", "/api/nope", auth=token())[0] == 404
    assert http(base_url, "GET", "/", auth=token())[0] == 404


def test_upload_search_download_delete_over_http(base_url):
    asha = token()
    status, created = http(base_url, "POST", "/api/files", asha, upload_payload(title="Over the wire"))
    assert status == 201
    file_id = created["file"]["fileId"]

    form = created["upload"]
    assert form["url"].startswith("http://127.0.0.1:")
    posted = requests.post(form["url"], data=form["fields"], files={"file": ("x", PDF)}, timeout=10)
    assert posted.status_code in (200, 201, 204), posted.text

    assert http(base_url, "POST", f"/api/files/{file_id}/complete", asha)[0] == 200
    status, listing = http(base_url, "GET", "/api/files?q=wire&subject=UCS531", asha)
    assert status == 200 and [f["fileId"] for f in listing["items"]] == [file_id]

    status, download = http(base_url, "GET", f"/api/files/{file_id}/download", token("ravi@thapar.edu", "Ravi"))
    assert status == 200 and download["downloadCount"] == 1
    fetched = requests.get(download["url"], timeout=10)
    assert fetched.content == PDF
    assert 'filename="unit3.pdf"' in fetched.headers["Content-Disposition"]

    assert http(base_url, "DELETE", f"/api/files/{file_id}", token("ravi@thapar.edu", "Ravi"))[0] == 403
    assert http(base_url, "DELETE", f"/api/files/{file_id}", asha) == (200, {"deleted": True})


def test_admin_dashboard_needs_the_admin_flag(base_url):
    assert http(base_url, "GET", "/api/admin/stats", token())[0] == 403
    status, stats = http(base_url, "GET", "/api/admin/stats", token("head@thapar.edu", "Head", admin=True))
    assert status == 200 and "totals" in stats and "platform" in stats


def test_browser_may_post_to_the_mock_bucket_from_the_dev_site(base_url):
    form = http(base_url, "POST", "/api/files", token(), upload_payload())[1]["upload"]
    preflight = requests.options(
        form["url"],
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
        timeout=10,
    )
    assert preflight.status_code == 200
    assert preflight.headers.get("Access-Control-Allow-Origin") in ("*", "http://localhost:5173")


def test_seed_fills_the_library_with_downloadable_pdfs(base_url):
    local_server.seed()
    status, listing = http(base_url, "GET", "/api/files?limit=50", token())
    assert status == 200 and len(listing["items"]) >= 6
    file_id = listing["items"][0]["fileId"]
    url = http(base_url, "GET", f"/api/files/{file_id}/download", token())[1]["url"]
    assert requests.get(url, timeout=10).content.startswith(b"%PDF-")
