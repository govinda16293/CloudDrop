"""The one error type the API layer turns into an HTTP response."""


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found() -> ApiError:
    return ApiError(404, "not_found", "That file does not exist.")


def aws_error_code(error) -> str:
    """The code inside a botocore ClientError, e.g. "ConditionalCheckFailedException"."""
    return error.response.get("Error", {}).get("Code", "")
