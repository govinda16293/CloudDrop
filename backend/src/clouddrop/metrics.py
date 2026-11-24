"""CloudWatch: write business metrics, read platform metrics.

Writing uses the Embedded Metric Format: a JSON line printed to the log, which
CloudWatch turns into a metric. It needs no API call and no IAM permission.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

NAMESPACE = "CloudDrop"


def emit(name: str, value: float = 1, unit: str = "Count", *, stack=None, out=None, now=None) -> None:
    timestamp = (now or _utc_now)()
    record = {
        "_aws": {
            "Timestamp": int(timestamp.timestamp() * 1000),
            "CloudWatchMetrics": [
                {"Namespace": NAMESPACE, "Dimensions": [["Stack"]], "Metrics": [{"Name": name, "Unit": unit}]}
            ],
        },
        "Stack": stack or os.environ.get("STACK_NAME", "clouddrop"),
        name: value,
    }
    print(json.dumps(record), file=out or sys.stdout, flush=True)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _query(query_id: str, namespace: str, metric: str, dimensions: dict, stat: str) -> dict:
    return {
        "Id": query_id,
        "MetricStat": {
            "Metric": {
                "Namespace": namespace,
                "MetricName": metric,
                "Dimensions": [{"Name": k, "Value": v} for k, v in dimensions.items()],
            },
            "Period": 3600,
            "Stat": stat,
        },
        "ReturnData": True,
    }


def fetch_platform_metrics(cloudwatch, api_name: str, stage: str, function_names, hours: int = 24, now=None) -> dict:
    """API Gateway and Lambda numbers for the last `hours`, for the admin dashboard."""
    end = (now or _utc_now)().replace(second=0, microsecond=0) + timedelta(minutes=1)
    api = {"ApiName": api_name, "Stage": stage}
    queries = [
        _query("apiCount", "AWS/ApiGateway", "Count", api, "Sum"),
        _query("api4xx", "AWS/ApiGateway", "4XXError", api, "Sum"),
        _query("api5xx", "AWS/ApiGateway", "5XXError", api, "Sum"),
        _query("apiLatencySum", "AWS/ApiGateway", "Latency", api, "Sum"),
        _query("apiLatencyCount", "AWS/ApiGateway", "Latency", api, "SampleCount"),
    ]
    for n, function in enumerate(function_names):
        dimensions = {"FunctionName": function}
        queries += [
            _query(f"fnInvocations{n}", "AWS/Lambda", "Invocations", dimensions, "Sum"),
            _query(f"fnErrors{n}", "AWS/Lambda", "Errors", dimensions, "Sum"),
            _query(f"fnDuration{n}", "AWS/Lambda", "Duration", dimensions, "Sum"),
        ]

    totals: dict[str, float] = {}
    try:
        request = {"MetricDataQueries": queries, "StartTime": end - timedelta(hours=hours), "EndTime": end}
        while True:
            response = cloudwatch.get_metric_data(**request)
            for result in response["MetricDataResults"]:
                totals[result["Id"]] = totals.get(result["Id"], 0) + sum(result["Values"])
            if not response.get("NextToken"):
                break
            request["NextToken"] = response["NextToken"]
    except Exception as error:  # noqa: BLE001 - the dashboard must still load without metrics
        # Printed so a missing permission shows up in the function's log.
        print(json.dumps({"level": "ERROR", "message": "platform metrics unavailable", "error": repr(error)}))
        return {"available": False, "periodHours": hours}

    def total(prefix: str) -> float:
        return sum(value for key, value in totals.items() if key.startswith(prefix))

    def average(amount: float, count: float):
        return round(amount / count, 1) if count else None

    invocations = total("fnInvocations")
    return {
        "available": True,
        "periodHours": hours,
        "api": {
            "requests": int(total("apiCount")),
            "errors4xx": int(total("api4xx")),
            "errors5xx": int(total("api5xx")),
            "avgLatencyMs": average(total("apiLatencySum"), total("apiLatencyCount")),
        },
        "lambda": {
            "invocations": int(invocations),
            "errors": int(total("fnErrors")),
            "avgDurationMs": average(total("fnDuration"), invocations),
        },
    }
