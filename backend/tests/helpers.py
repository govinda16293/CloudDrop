"""Shared builders for tests."""


def make_item(file_id="f1", **overrides):
    """A PENDING metadata item, the shape FileService writes."""
    item = {
        "fileId": file_id,
        "status": "PENDING",
        "title": "Unit 3 notes",
        "fileName": "unit3.pdf",
        "contentType": "application/pdf",
        "size": 1000,
        "subjectCode": "UCS531",
        "semester": 5,
        "resourceType": "notes",
        "tags": ["virtualization"],
        "description": "",
        "uploaderId": "user-1",
        "uploaderName": "Asha",
        "createdAt": "2026-11-20T10:00:00.000000Z",
        "downloadCount": 0,
        "searchText": "unit 3 notes unit3.pdf ucs531 virtualization",
        "expiresAt": 1_800_000_000,
    }
    item.update(overrides)
    return item


PDF = b"%PDF-1.7 fake notes " * 10


def browser_upload(form, body=PDF):
    """Do what the browser does with a pre-signed POST: fields first, file last."""
    import requests

    response = requests.post(form["url"], data=form["fields"], files={"file": ("upload", body)}, timeout=5)
    assert response.status_code in (200, 201, 204), response.text


def upload_payload(**overrides):
    payload = {
        "title": "Unit 3 notes",
        "fileName": "unit3.pdf",
        "size": len(PDF),
        "subjectCode": "UCS531",
        "semester": 5,
        "resourceType": "notes",
        "tags": ["virtualization"],
        "description": "Notes for unit 3.",
    }
    payload.update(overrides)
    return payload


def claims_for(user, groups=None):
    """The claims API Gateway's Cognito authorizer passes to Lambda."""
    claims = {"sub": user.id, "email": user.email, "name": user.name, "email_verified": "true"}
    if groups is not None:
        claims["cognito:groups"] = groups
    return claims


def api_event(method, resource, claims=None, path=None, query=None, body=None):
    """An API Gateway REST (v1) Lambda proxy event."""
    import json

    return {
        "resource": resource,
        "path": resource,
        "httpMethod": method,
        "headers": {"Authorization": "token"},
        "queryStringParameters": query,
        "pathParameters": path,
        "requestContext": {"authorizer": {"claims": claims}} if claims is not None else {},
        "body": json.dumps(body) if isinstance(body, (dict, list)) else body,
        "isBase64Encoded": False,
    }
