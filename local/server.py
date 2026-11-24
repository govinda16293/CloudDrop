"""Run CloudDrop on a laptop with no AWS account.

Two servers start in this process:

  * a mock AWS (moto) holding an in-memory S3 bucket and DynamoDB table, and
  * a stand-in for API Gateway that turns each HTTP request into the same
    Lambda proxy event the real one sends, then calls the real handlers.

The stand-in also replaces Cognito: it trusts a "local." token that anyone can
make. That is why this file lives outside backend/src and is never deployed.

    python -m local.server --seed
"""

import argparse
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import sys
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend" / "src"))

import boto3  # noqa: E402
from moto.server import ThreadedMotoServer  # noqa: E402

from clouddrop import wiring  # noqa: E402
from clouddrop.handlers import admin as admin_handler  # noqa: E402
from clouddrop.config import DEFAULT_EMAIL_DOMAIN  # noqa: E402
from clouddrop.handlers import files as files_handler  # noqa: E402
from clouddrop.http import ADMIN_GROUP  # noqa: E402
from clouddrop.validation import is_allowed_email  # noqa: E402
from local.bootstrap import create_resources  # noqa: E402
from local.seed import seed  # noqa: E402

REGION = "ap-south-1"
TABLE = "clouddrop-local-files"
BUCKET = "clouddrop-local-files-000000000000"
EMAIL_DOMAIN = DEFAULT_EMAIL_DOMAIN
TOKEN_PREFIX = "local."


def _compile(routes: dict, handler) -> list:
    compiled = []
    for method, resource in routes:
        pattern = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", resource)
        compiled.append((method, re.compile(f"^{pattern}$"), resource, handler))
    return compiled


ROUTES = _compile(files_handler.ROUTES, files_handler.handler) + _compile(admin_handler.ROUTES, admin_handler.handler)


def make_local_token(email: str, name: str, admin: bool = False) -> str:
    payload = json.dumps({"email": email, "name": name, "admin": admin}).encode()
    return TOKEN_PREFIX + base64.urlsafe_b64encode(payload).decode().rstrip("=")


def claims_from_token(authorization: str | None) -> dict | None:
    """The claims Cognito would have put in the event, or None if the token is no good."""
    token = (authorization or "").strip()
    if not token.startswith(TOKEN_PREFIX):
        return None
    encoded = token[len(TOKEN_PREFIX):]
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("email"), str):
        return None
    email = payload["email"].strip().lower()
    claims = {
        "sub": "local-" + hashlib.sha256(email.encode()).hexdigest()[:16],
        "email": email,
        "name": str(payload.get("name") or ""),
        "email_verified": "true",
    }
    if payload.get("admin") is True:
        claims["cognito:groups"] = ADMIN_GROUP
    return claims


def handle(method: str, raw_path: str, authorization: str | None, body: str | None) -> tuple[int, dict, str]:
    """One request in, (status, headers, body) out."""
    url = urlsplit(raw_path)
    json_headers = {"Content-Type": "application/json", "Cache-Control": "no-store"}

    claims = claims_from_token(authorization)
    if claims is None:
        return 401, json_headers, json.dumps({"message": "Unauthorized"})
    if not is_allowed_email(claims["email"], EMAIL_DOMAIN):
        message = f"Only @{EMAIL_DOMAIN} e-mail addresses can use CloudDrop."
        return 403, json_headers, json.dumps({"message": message})

    for route_method, pattern, resource, handler in ROUTES:
        match = pattern.match(url.path)
        if match and route_method == method:
            event = {
                "resource": resource,
                "path": url.path,
                "httpMethod": method,
                "headers": {},
                "queryStringParameters": dict(parse_qsl(url.query, keep_blank_values=True)) or None,
                "pathParameters": match.groupdict() or None,
                "requestContext": {"authorizer": {"claims": claims}},
                "body": body,
                "isBase64Encoded": False,
            }
            response = handler(event, None)
            return response["statusCode"], response["headers"], response["body"]
    return 404, json_headers, json.dumps({"message": "Not Found"})


class _RequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _serve(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else None
        status, headers, payload = handle(self.command, self.path, self.headers.get("Authorization"), body)
        data = payload.encode("utf-8")
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _serve

    def log_message(self, format, *args):  # noqa: A002 - signature set by the base class
        if not getattr(self.server, "quiet", False):
            sys.stderr.write("api  %s\n" % (format % args))


@dataclass
class Running:
    api_port: int
    mock_port: int
    _stoppers: list = field(default_factory=list)

    def stop(self) -> None:
        for stopper in reversed(self._stoppers):
            stopper()


def start(api_port: int = 8787, mock_port: int = 5001, quiet: bool = True) -> Running:
    mock_url = f"http://127.0.0.1:{mock_port}"
    environment = {
        "AWS_ACCESS_KEY_ID": "local",
        "AWS_SECRET_ACCESS_KEY": "local",
        "AWS_DEFAULT_REGION": REGION,
        "AWS_ENDPOINT_URL": mock_url,  # DynamoDB and CloudWatch clients
        "S3_ENDPOINT_URL": mock_url,  # also the address inside pre-signed URLs
        "TABLE_NAME": TABLE,
        "BUCKET_NAME": BUCKET,
        "MAX_FILE_MB": "25",
        "STACK_NAME": "clouddrop-local",
        "ALLOWED_EMAIL_DOMAIN": EMAIL_DOMAIN,
        "API_NAME": "clouddrop-local-api",
        "METRIC_FUNCTIONS": "clouddrop-local-files,clouddrop-local-admin",
    }
    # Left set, these would send boto3 to a real AWS account or region instead of the mock.
    removed = ("AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_REGION")
    before = {name: os.environ.get(name) for name in (*environment, *removed)}

    def restore_environment():
        for name, value in before.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        wiring.reset()

    running = Running(api_port, mock_port)
    os.environ.update(environment)
    for name in removed:
        os.environ.pop(name, None)
    wiring.reset()
    running._stoppers.append(restore_environment)

    logging.getLogger("werkzeug").setLevel(logging.ERROR)  # the mock logs every request otherwise
    mock = ThreadedMotoServer(ip_address="127.0.0.1", port=mock_port, verbose=False)
    mock.start()
    running._stoppers.append(mock.stop)

    s3 = boto3.client("s3", region_name=REGION, endpoint_url=mock_url)
    create_resources(boto3.client("dynamodb", region_name=REGION), s3, TABLE, BUCKET, REGION)
    s3.put_bucket_cors(
        Bucket=BUCKET,
        CORSConfiguration={
            "CORSRules": [{"AllowedMethods": ["POST"], "AllowedOrigins": ["*"], "AllowedHeaders": ["*"]}]
        },
    )

    httpd = ThreadingHTTPServer(("127.0.0.1", api_port), _RequestHandler)
    httpd.quiet = quiet
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    # stop() runs these last-in-first-out: shutdown() must come before server_close().
    running._stoppers.append(httpd.server_close)
    running._stoppers.append(httpd.shutdown)
    return running


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CloudDrop locally against a mock AWS.")
    parser.add_argument("--api-port", type=int, default=8787)
    parser.add_argument("--mock-port", type=int, default=5001)
    parser.add_argument("--seed", action="store_true", help="add sample files")
    args = parser.parse_args()

    running = start(args.api_port, args.mock_port, quiet=False)
    if args.seed:
        print(f"seeded {seed()} sample files")
    print(f"API       http://127.0.0.1:{running.api_port}/api")
    print(f"mock AWS  http://127.0.0.1:{running.mock_port}")
    print("Data is kept in memory and is gone when this stops. Ctrl-C to stop.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        running.stop()


if __name__ == "__main__":
    main()
