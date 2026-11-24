"""S3 access. File bytes never pass through Lambda: the browser uploads and
downloads directly with short-lived pre-signed URLs made here.

Keys hold only the file id (pending/<id>, files/<id>). The human file name
lives in DynamoDB and is attached at download time, so spaces, brackets or
non-English letters in a name can never break an S3 key or a copy.
"""

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .errors import aws_error_code


def make_s3_client(region: str, endpoint_url: str | None = None):
    """An S3 client whose pre-signed URLs work from a browser.

    The regional endpoint and SigV4 are set explicitly: a URL signed for the
    global endpoint is answered with a redirect for a newly created bucket,
    and a browser's cross-origin POST can not follow it.
    """
    return boto3.client(
        "s3",
        region_name=region,
        endpoint_url=endpoint_url or f"https://s3.{region}.amazonaws.com",
        config=Config(
            signature_version="s3v4",
            # A custom endpoint means the local mock, which is path-style only.
            s3={"addressing_style": "path" if endpoint_url else "virtual"},
        ),
    )


class FileStorage:
    def __init__(self, s3_client, bucket: str):
        self._s3 = s3_client
        self._bucket = bucket

    def presign_upload(self, key: str, content_type: str, size: int, ttl: int) -> dict:
        """Form fields for a browser POST of exactly `size` bytes.

        S3 itself enforces the size. Signing the exact size (not "up to the
        limit") means a leaked or replayed form can not store anything bigger
        than what the API approved."""
        return self._s3.generate_presigned_post(
            Bucket=self._bucket,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}, ["content-length-range", size, size]],
            ExpiresIn=ttl,
        )

    def head(self, key: str) -> dict | None:
        try:
            response = self._s3.head_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            if aws_error_code(error) in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return {"size": response["ContentLength"]}

    def copy_to_final(self, pending_key: str, final_key: str, content_type: str) -> None:
        """Copy a confirmed upload out of pending/ (which a lifecycle rule empties daily).

        Copy only: the caller deletes the pending object after it has recorded
        success, so a failure in between can simply be retried."""
        self._s3.copy_object(
            Bucket=self._bucket,
            Key=final_key,
            CopySource={"Bucket": self._bucket, "Key": pending_key},
            ContentType=content_type,
            MetadataDirective="REPLACE",
        )

    def presign_download(self, key: str, file_name: str, ttl: int) -> str:
        return self._s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._bucket,
                "Key": key,
                # file_name is already limited to safe ASCII by validation.
                "ResponseContentDisposition": f'attachment; filename="{file_name}"',
            },
            ExpiresIn=ttl,
        )

    def delete(self, key: str) -> None:
        self._s3.delete_object(Bucket=self._bucket, Key=key)
