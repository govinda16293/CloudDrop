import io
import json
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

from clouddrop import metrics

NOW = datetime(2026, 11, 20, 10, 7, 30, tzinfo=timezone.utc)


def test_emit_writes_one_embedded_metric_format_line():
    out = io.StringIO()
    metrics.emit("FilesUploaded", stack="clouddrop", out=out, now=lambda: NOW)
    (line,) = out.getvalue().splitlines()
    record = json.loads(line)
    assert record["FilesUploaded"] == 1 and record["Stack"] == "clouddrop"
    assert record["_aws"]["Timestamp"] == int(NOW.timestamp() * 1000)
    (directive,) = record["_aws"]["CloudWatchMetrics"]
    assert directive == {
        "Namespace": "CloudDrop",
        "Dimensions": [["Stack"]],
        "Metrics": [{"Name": "FilesUploaded", "Unit": "Count"}],
    }


class FakeCloudWatch:
    """Stands in for CloudWatch, which the mock library can not fill with AWS/* metrics.

    values maps (api or function name, metric, statistic) to the datapoints returned.
    """

    def __init__(self, values):
        self.values = values
        self.requests = []

    def get_metric_data(self, **request):
        self.requests.append(request)
        results = []
        for query in request["MetricDataQueries"]:
            stat = query["MetricStat"]
            dimensions = {d["Name"]: d["Value"] for d in stat["Metric"]["Dimensions"]}
            owner = dimensions.get("FunctionName") or dimensions.get("ApiName")
            values = self.values.get((owner, stat["Metric"]["MetricName"], stat["Stat"]), [])
            results.append({"Id": query["Id"], "Values": values})
        return {"MetricDataResults": results}


def fetch(client):
    return metrics.fetch_platform_metrics(client, "cd-api", "prod", ("cd-files", "cd-admin"), hours=24, now=lambda: NOW)


def test_platform_metrics_add_up_every_datapoint_and_weight_the_averages():
    client = FakeCloudWatch({
        ("cd-api", "Count", "Sum"): [100, 20],
        ("cd-api", "4XXError", "Sum"): [7],
        ("cd-api", "5XXError", "Sum"): [1],
        ("cd-api", "Latency", "Sum"): [4000.0, 1088.0],
        ("cd-api", "Latency", "SampleCount"): [100, 20],
        ("cd-files", "Invocations", "Sum"): [100],
        ("cd-files", "Errors", "Sum"): [2],
        ("cd-files", "Duration", "Sum"): [3000.0],
        ("cd-admin", "Invocations", "Sum"): [20],
        ("cd-admin", "Errors", "Sum"): [0],
        ("cd-admin", "Duration", "Sum"): [1800.0],
    })
    assert fetch(client) == {
        "available": True,
        "periodHours": 24,
        "api": {"requests": 120, "errors4xx": 7, "errors5xx": 1, "avgLatencyMs": 42.4},
        "lambda": {"invocations": 120, "errors": 2, "avgDurationMs": 40.0},
    }


def test_platform_metrics_ask_for_hourly_points_over_a_whole_minute_window():
    client = FakeCloudWatch({})
    fetch(client)
    (request,) = client.requests
    assert request["EndTime"] == datetime(2026, 11, 20, 10, 8, tzinfo=timezone.utc)
    assert (request["EndTime"] - request["StartTime"]).total_seconds() == 24 * 3600
    assert {q["MetricStat"]["Period"] for q in request["MetricDataQueries"]} == {3600}
    ids = [q["Id"] for q in request["MetricDataQueries"]]
    assert len(ids) == len(set(ids)) and all(i[0].islower() and i.isalnum() for i in ids)
    api_dims = request["MetricDataQueries"][0]["MetricStat"]["Metric"]["Dimensions"]
    assert {"Name": "Stage", "Value": "prod"} in api_dims and {"Name": "ApiName", "Value": "cd-api"} in api_dims


def test_platform_metrics_with_no_traffic_are_zero_not_missing(aws):
    result = fetch(boto3.client("cloudwatch", region_name="ap-south-1"))
    assert result["available"] is True
    assert result["api"] == {"requests": 0, "errors4xx": 0, "errors5xx": 0, "avgLatencyMs": None}
    assert result["lambda"] == {"invocations": 0, "errors": 0, "avgDurationMs": None}


def test_platform_metrics_failure_is_reported_and_logged(capsys):
    class Denied:
        def get_metric_data(self, **request):
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "no"}}, "GetMetricData")

    assert fetch(Denied()) == {"available": False, "periodHours": 24}
    assert "AccessDenied" in capsys.readouterr().out
