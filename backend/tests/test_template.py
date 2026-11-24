"""Checks on infra/template.yaml that a linter does not make.

These guard the security and cost decisions in the design, so that a later
edit to the template can not quietly undo them.
"""

import pytest

from local.bootstrap import load_template


@pytest.fixture(scope="module")
def resources():
    return load_template()["Resources"]


def functions(resources):
    return {name: r for name, r in resources.items() if r["Type"] == "AWS::Serverless::Function"}


def allow_statements(function):
    for policy in function["Properties"].get("Policies", []):
        for statement in policy["Statement"]:
            if statement["Effect"] == "Allow":
                yield statement


def as_list(value):
    return value if isinstance(value, list) else [value]


def test_files_bucket_is_private_versioned_and_encrypted(resources):
    props = resources["FilesBucket"]["Properties"]
    assert props["VersioningConfiguration"] == {"Status": "Enabled"}
    assert all(props["PublicAccessBlockConfiguration"].values())
    assert len(props["PublicAccessBlockConfiguration"]) == 4
    rule = props["BucketEncryption"]["ServerSideEncryptionConfiguration"][0]
    assert rule["ServerSideEncryptionByDefault"]["SSEAlgorithm"] == "AES256"


def test_files_bucket_lifecycle_cleans_abandoned_uploads_and_old_versions(resources):
    rules = {r["Id"]: r for r in resources["FilesBucket"]["Properties"]["LifecycleConfiguration"]["Rules"]}
    pending = rules["ExpireAbandonedUploads"]
    assert pending["Prefix"] == "pending/" and pending["ExpirationInDays"] == 1
    stored = rules["TierAndTrimStoredFiles"]
    assert stored["Prefix"] == "files/"
    assert stored["NoncurrentVersionExpiration"]["NoncurrentDays"] == 30
    assert stored["Transitions"][0]["StorageClass"] == "STANDARD_IA"
    assert rules["RemoveExpiredDeleteMarkers"]["ExpiredObjectDeleteMarker"] is True
    assert all(r["Status"] == "Enabled" for r in rules.values())


def test_files_bucket_cors_only_allows_the_site_to_post(resources):
    (rule,) = resources["FilesBucket"]["Properties"]["CorsConfiguration"]["CorsRules"]
    assert rule["AllowedMethods"] == ["POST"]
    assert rule["AllowedOrigins"] == [{"Fn::Sub": "https://${Distribution.DomainName}"}]


def test_site_bucket_is_private_and_only_cloudfront_can_read_it(resources):
    assert all(resources["SiteBucket"]["Properties"]["PublicAccessBlockConfiguration"].values())
    statements = resources["SiteBucketPolicy"]["Properties"]["PolicyDocument"]["Statement"]
    (allow,) = [s for s in statements if s["Effect"] == "Allow"]
    assert allow["Principal"] == {"Service": "cloudfront.amazonaws.com"}
    assert allow["Action"] == "s3:GetObject"
    assert "AWS:SourceArn" in allow["Condition"]["StringEquals"]


def test_both_buckets_refuse_plain_http(resources):
    for name in ("FilesBucketPolicy", "SiteBucketPolicy"):
        statements = resources[name]["Properties"]["PolicyDocument"]["Statement"]
        deny = [s for s in statements if s["Effect"] == "Deny"]
        assert deny and deny[0]["Condition"] == {"Bool": {"aws:SecureTransport": "false"}}


def test_table_has_the_three_sparse_indexes_and_a_ttl(resources):
    props = resources["FilesTable"]["Properties"]
    assert props["BillingMode"] == "PAY_PER_REQUEST"
    assert props["KeySchema"] == [{"AttributeName": "fileId", "KeyType": "HASH"}]
    indexes = {
        i["IndexName"]: [k["AttributeName"] for k in i["KeySchema"]] for i in props["GlobalSecondaryIndexes"]
    }
    assert indexes == {
        "byRecent": ["gsiAll", "createdAt"],
        "bySubject": ["gsiSubject", "createdAt"],
        "byUploader": ["gsiUploader", "createdAt"],
    }
    assert props["TimeToLiveSpecification"] == {"AttributeName": "expiresAt", "Enabled": True}


def test_every_route_is_under_api_and_behind_the_cognito_authorizer(resources):
    auth = resources["Api"]["Properties"]["Auth"]
    assert auth["DefaultAuthorizer"] == "CognitoAuthorizer"
    assert auth["Authorizers"]["CognitoAuthorizer"]["UserPoolArn"] == {"Fn::GetAtt": "UserPool.Arn"}
    routes = 0
    for function in functions(resources).values():
        for event in function["Properties"].get("Events", {}).values():
            assert event["Type"] == "Api"
            props = event["Properties"]
            assert props["Path"].startswith("/api/")
            assert props["RestApiId"] == {"Ref": "Api"}
            assert "Auth" not in props, "no route may override the default authorizer"
            routes += 1
    assert routes >= 8


def test_no_function_is_granted_a_wildcard_action(resources):
    for name, function in functions(resources).items():
        for statement in allow_statements(function):
            for action in as_list(statement["Action"]):
                assert "*" not in action, f"{name} allows {action}"


def test_only_metric_reads_use_a_wildcard_resource(resources):
    for name, function in functions(resources).items():
        for statement in allow_statements(function):
            if statement["Resource"] == "*":
                # CloudWatch GetMetricData does not support resource-level permissions.
                assert as_list(statement["Action"]) == ["cloudwatch:GetMetricData"], name


def test_presignup_function_has_no_aws_permissions(resources):
    assert "Policies" not in resources["PreSignUpFunction"]["Properties"]


def test_cognito_can_invoke_the_presignup_trigger(resources):
    pool = resources["UserPool"]["Properties"]
    assert pool["LambdaConfig"] == {"PreSignUp": {"Fn::GetAtt": "PreSignUpFunction.Arn"}}
    assert pool["AutoVerifiedAttributes"] == ["email"]
    # Changing your e-mail must not take effect until the new address is proven.
    assert pool["UserAttributeUpdateSettings"] == {"AttributesRequireVerificationBeforeUpdate": ["email"]}
    permission = resources["PreSignUpPermission"]["Properties"]
    assert permission["Principal"] == "cognito-idp.amazonaws.com"
    assert permission["SourceArn"] == {"Fn::GetAtt": "UserPool.Arn"}


def test_app_client_is_a_public_srp_client(resources):
    client = resources["UserPoolClient"]["Properties"]
    assert client["GenerateSecret"] is False
    assert "ALLOW_USER_SRP_AUTH" in client["ExplicitAuthFlows"]
    assert "ALLOW_USER_PASSWORD_AUTH" not in client["ExplicitAuthFlows"]


def test_cloudfront_serves_the_site_and_proxies_the_api(resources):
    config = resources["Distribution"]["Properties"]["DistributionConfig"]
    assert config["DefaultRootObject"] == "index.html"
    assert config["DefaultCacheBehavior"]["ViewerProtocolPolicy"] == "redirect-to-https"
    # A SPA-style "send 403/404 to index.html" rule would also rewrite API errors.
    assert "CustomErrorResponses" not in config
    (api,) = config["CacheBehaviors"]
    assert api["PathPattern"] == "/api/*"
    assert sorted(api["AllowedMethods"]) == ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    assert api["CachePolicyId"] == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"  # Managed-CachingDisabled
    assert api["OriginRequestPolicyId"] == "b689b0a8-53d0-40ab-baf2-68738e2966ac"  # AllViewerExceptHostHeader
    origins = {o["Id"]: o for o in config["Origins"]}
    assert origins["api"]["OriginPath"] == "/prod"
    assert origins["api"]["CustomOriginConfig"]["OriginProtocolPolicy"] == "https-only"
    assert "OriginAccessControlId" in origins["site"]


def test_lambda_package_is_the_backend_source_only(resources):
    template = load_template()
    assert template["Globals"]["Function"]["CodeUri"] == "../backend/src"
    assert template["Globals"]["Function"]["Runtime"] == "python3.13"


def test_files_function_gets_the_per_user_limit(resources):
    variables = resources["FilesFunction"]["Properties"]["Environment"]["Variables"]
    assert variables["MAX_FILES_PER_USER"] == {"Ref": "MaxFilesPerUser"}
    assert load_template()["Parameters"]["MaxFilesPerUser"]["Default"] == 200
