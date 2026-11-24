"""The mock ignores IAM, so nothing else would notice a missing permission
until the first real deploy. This test records every AWS call the functions
make and checks the template's policy for that function allows it.
"""

import json
from fnmatch import fnmatchcase

import botocore.client
import pytest

from clouddrop.handlers import admin as admin_handler
from clouddrop.handlers import files as files_handler
from helpers import api_event, browser_upload, claims_for, upload_payload
from local.bootstrap import load_template

STACK = "clouddrop-test"  # settings.bucket_name is this plus "-files-" plus the account id

PARTITION, ACCOUNT, TABLE_ARN = "aws", "123456789012", "arn:aws:dynamodb:ap-south-1:123456789012:table/files"


@pytest.fixture
def recorded(monkeypatch):
    calls = []
    real = botocore.client.BaseClient._make_api_call

    def record(self, operation_name, api_params):
        calls.append((self.meta.service_model.service_name, operation_name, dict(api_params)))
        return real(self, operation_name, api_params)

    monkeypatch.setattr(botocore.client.BaseClient, "_make_api_call", record)
    return calls


def needed(service, operation, params):
    """The (IAM action, resource ARN) pairs one AWS call requires."""
    if service == "dynamodb":
        arn = TABLE_ARN + (f"/index/{params['IndexName']}" if "IndexName" in params else "")
        assert operation in ("GetItem", "PutItem", "UpdateItem", "DeleteItem", "Query"), operation
        return [(f"dynamodb:{operation}", arn)]
    if service == "s3":
        bucket = f"arn:aws:s3:::{params['Bucket']}"
        key = f"{bucket}/{params['Key']}"
        if operation == "HeadObject":
            return [("s3:GetObject", key), ("s3:ListBucket", bucket)]
        if operation == "CopyObject":
            source = params["CopySource"]
            return [("s3:GetObject", f"arn:aws:s3:::{source['Bucket']}/{source['Key']}"), ("s3:PutObject", key)]
        if operation == "DeleteObject":
            return [("s3:DeleteObject", key)]
    if (service, operation) == ("cloudwatch", "GetMetricData"):
        return [("cloudwatch:GetMetricData", "*")]
    raise AssertionError(f"teach this test what {service}:{operation} needs")


def resolve(resource, stack_name):
    if isinstance(resource, list):
        return [r for item in resource for r in resolve(item, stack_name)]
    if resource == {"Fn::GetAtt": "FilesTable.Arn"}:
        return [TABLE_ARN]
    if isinstance(resource, dict):
        text = resource["Fn::Sub"]
        for name, value in {
            "${FilesTable.Arn}": TABLE_ARN,
            "${AWS::Partition}": PARTITION,
            "${AWS::StackName}": stack_name,
            "${AWS::AccountId}": ACCOUNT,
        }.items():
            text = text.replace(name, value)
        assert "${" not in text, text
        return [text]
    return [resource]


def allowed_by(function_name, stack_name):
    grants = []
    function = load_template()["Resources"][function_name]["Properties"]
    for policy in function["Policies"]:
        for statement in policy["Statement"]:
            assert statement["Effect"] == "Allow"
            actions = statement["Action"] if isinstance(statement["Action"], list) else [statement["Action"]]
            for action in actions:
                for arn in resolve(statement["Resource"], stack_name):
                    grants.append((action, arn))
    return grants


def assert_allowed(function_name, calls, stack_name):
    grants = allowed_by(function_name, stack_name)
    assert calls, "nothing was recorded"
    for service, operation, params in calls:
        for action, arn in needed(service, operation, params):
            assert any(action == granted and fnmatchcase(arn, pattern) for granted, pattern in grants), (
                f"{function_name} calls {service}:{operation} which needs {action} on {arn}"
            )


def run(handler, *args, **kwargs):
    response = handler.handler(api_event(*args, **kwargs), None)
    assert response["statusCode"] < 400, response["body"]
    return json.loads(response["body"])


def test_files_function_policy_covers_every_call_it_makes(lambda_env, settings, asha, recorded):
    stack = STACK
    assert settings.bucket_name == f"{stack}-files-{ACCOUNT}", "bucket name must follow the template's pattern"
    claims = claims_for(asha)
    created = run(files_handler, "POST", "/api/files", claims, body=upload_payload())
    file_id = created["file"]["fileId"]
    browser_upload(created["upload"])
    path = {"id": file_id}
    recorded.clear()  # drop the calls the test's own browser stand-in made

    run(files_handler, "POST", "/api/files", claims, body=upload_payload(title="second, cancelled"))
    run(files_handler, "POST", "/api/files/{id}/complete", claims, path=path)
    run(files_handler, "GET", "/api/files", claims, query={"subject": "UCS531", "q": "unit"})
    run(files_handler, "GET", "/api/files", claims, query={"mine": "1"})
    run(files_handler, "GET", "/api/files", claims)
    run(files_handler, "GET", "/api/files/{id}", claims, path=path)
    run(files_handler, "GET", "/api/files/{id}/download", claims, path=path)
    run(files_handler, "DELETE", "/api/files/{id}", claims, path=path)

    # Pre-signing makes no AWS call, but the link only works if the function's
    # own role may do what the link does.
    bucket = settings.bucket_name
    presigned = [
        ("s3", "PutObject", {"Bucket": bucket, "Key": f"pending/{file_id}"}),
        ("s3", "GetObject", {"Bucket": bucket, "Key": f"files/{file_id}"}),
    ]
    grants = allowed_by("FilesFunction", stack)
    for _, operation, params in presigned:
        arn = f"arn:aws:s3:::{params['Bucket']}/{params['Key']}"
        assert any(g == f"s3:{operation}" and fnmatchcase(arn, pattern) for g, pattern in grants), operation

    operations = {(service, operation) for service, operation, _ in recorded}
    assert {("s3", "HeadObject"), ("s3", "CopyObject"), ("s3", "DeleteObject"), ("dynamodb", "Query")} <= operations
    assert_allowed("FilesFunction", recorded, stack)


def test_admin_function_policy_covers_every_call_it_makes(lambda_env, settings, admin, recorded):
    run(admin_handler, "GET", "/api/admin/stats", claims_for(admin, groups="admins"))
    assert {(s, o) for s, o, _ in recorded} == {("dynamodb", "Query"), ("cloudwatch", "GetMetricData")}
    assert_allowed("AdminFunction", recorded, STACK)


def test_admin_function_can_only_read(settings):
    actions = {action for action, _ in allowed_by("AdminFunction", STACK)}
    assert actions == {"dynamodb:Query", "cloudwatch:GetMetricData"}


def test_the_check_itself_catches_a_missing_permission(settings):
    calls = [("s3", "DeleteObject", {"Bucket": settings.bucket_name, "Key": "files/x"})]
    with pytest.raises(AssertionError, match="s3:DeleteObject"):
        assert_allowed("AdminFunction", calls, STACK)
