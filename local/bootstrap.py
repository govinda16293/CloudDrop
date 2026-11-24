"""Create the mock AWS resources from infra/template.yaml.

Tests and local mode both call this, so the table they run against has the
same keys and indexes as the one CloudFormation deploys.
"""

from pathlib import Path

import yaml

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "infra" / "template.yaml"


class _CloudFormationLoader(yaml.SafeLoader):
    """SafeLoader that also understands !Ref, !Sub, !GetAtt and friends."""


def _intrinsic(loader, suffix, node):
    name = suffix if suffix == "Ref" else f"Fn::{suffix}"
    if isinstance(node, yaml.ScalarNode):
        return {name: loader.construct_scalar(node)}
    if isinstance(node, yaml.SequenceNode):
        return {name: loader.construct_sequence(node, deep=True)}
    return {name: loader.construct_mapping(node, deep=True)}


_CloudFormationLoader.add_multi_constructor("!", _intrinsic)


def load_template(path=None) -> dict:
    with open(path or TEMPLATE_PATH, encoding="utf-8") as handle:
        return yaml.load(handle, Loader=_CloudFormationLoader)  # noqa: S506 - subclass of SafeLoader


def create_resources(dynamodb, s3, table_name: str, bucket_name: str, region: str) -> None:
    """dynamodb and s3 are boto3 clients pointed at the mock."""
    table = load_template()["Resources"]["FilesTable"]["Properties"]
    dynamodb.create_table(
        TableName=table_name,
        BillingMode=table["BillingMode"],
        AttributeDefinitions=table["AttributeDefinitions"],
        KeySchema=table["KeySchema"],
        GlobalSecondaryIndexes=table["GlobalSecondaryIndexes"],
    )
    s3.create_bucket(Bucket=bucket_name, CreateBucketConfiguration={"LocationConstraint": region})
    s3.put_bucket_versioning(Bucket=bucket_name, VersioningConfiguration={"Status": "Enabled"})
