"""Lambda behind /api/admin/stats. Has read-only permissions."""

from datetime import datetime, timezone

from ..errors import ApiError
from ..http import dispatch
from ..metrics import fetch_platform_metrics
from ..wiring import get_cloudwatch, get_service, get_settings


def _stats(user, event):
    if not user.is_admin:
        raise ApiError(403, "forbidden", "Only admins can open the dashboard.")
    settings = get_settings()
    stats = get_service().stats()
    stats["platform"] = fetch_platform_metrics(
        get_cloudwatch(), settings.api_name, settings.api_stage, settings.metric_functions
    )
    stats["generatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return 200, stats


# Keys must match the Events of AdminFunction in infra/template.yaml.
ROUTES = {("GET", "/api/admin/stats"): _stats}


def handler(event, context):
    return dispatch(ROUTES, event)
