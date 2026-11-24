"""Lambda behind every /api/files route and /api/me."""

from ..http import dispatch, file_id_from, parse_json_body
from ..wiring import get_service


def _me(user, event):
    return 200, {
        "user": {"id": user.id, "email": user.email, "name": user.name, "isAdmin": user.is_admin},
        "limits": get_service().limits(),
    }


def _list(user, event):
    return 200, get_service().list_files(user, event.get("queryStringParameters"))


def _create(user, event):
    return 201, get_service().create_upload(user, parse_json_body(event))


def _complete(user, event):
    return 200, get_service().complete_upload(user, file_id_from(event))


def _get(user, event):
    return 200, get_service().get_file(user, file_id_from(event))


def _download(user, event):
    return 200, get_service().get_download(user, file_id_from(event))


def _delete(user, event):
    get_service().delete_file(user, file_id_from(event))
    return 200, {"deleted": True}


# Keys must match the Events of FilesFunction in infra/template.yaml.
ROUTES = {
    ("GET", "/api/me"): _me,
    ("GET", "/api/files"): _list,
    ("POST", "/api/files"): _create,
    ("GET", "/api/files/{id}"): _get,
    ("DELETE", "/api/files/{id}"): _delete,
    ("POST", "/api/files/{id}/complete"): _complete,
    ("GET", "/api/files/{id}/download"): _download,
}


def handler(event, context):
    return dispatch(ROUTES, event)
