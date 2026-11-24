"""Cognito pre sign-up trigger: only institute e-mail addresses may register.

Raising makes Cognito refuse the sign-up and show the message to the user.
The address still has to be proven with the code Cognito e-mails to it.
"""

import os

from ..config import DEFAULT_EMAIL_DOMAIN
from ..validation import is_allowed_email


def handler(event, context):
    domain = os.environ.get("ALLOWED_EMAIL_DOMAIN", DEFAULT_EMAIL_DOMAIN)
    email = ((event.get("request") or {}).get("userAttributes") or {}).get("email")
    if not is_allowed_email(email, domain):
        raise Exception(f"Only @{domain} e-mail addresses can sign up.")
    return event
