"""Sample files for local mode, so the first screen is not empty."""

import requests

from clouddrop.config import DEFAULT_EMAIL_DOMAIN
from clouddrop.service import User
from clouddrop.wiring import get_service

SAMPLES = [
    ("Unit 1 - Introduction to Cloud Computing", "UCS531", 5, "notes", ["iaas", "paas", "saas"], "Asha Verma"),
    ("Unit 3 - Virtualization and Hypervisors", "UCS531", 5, "notes", ["virtualization", "xen", "kvm"], "Asha Verma"),
    ("Serverless and FaaS - lecture slides", "UCS531", 5, "slides", ["lambda", "serverless"], "Ravi Kumar"),
    ("Cloud Computing EST 2025 question paper", "UCS531", 5, "question-paper", ["est", "2025"], "Meera Shah"),
    ("AWS Lab 4 - S3 static hosting manual", "UCS531", 5, "lab-manual", ["s3", "cloudfront", "lab"], "Ravi Kumar"),
    ("DBMS normalisation cheat sheet", "UCS310", 4, "notes", ["normal forms", "sql"], "Meera Shah"),
    ("Operating Systems MST 2025 paper", "UCS303", 3, "question-paper", ["mst", "2025"], "Asha Verma"),
    ("Engineering Maths - Laplace transforms", "UMA010", 2, "notes", ["laplace"], "Kabir Singh"),
]


def make_pdf(title: str, lines: list[str]) -> bytes:
    """A small but valid one-page PDF, so seeded downloads really open."""

    def escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    content = [f"BT /F1 20 Tf 60 760 Td ({escape(title)}) Tj ET"]
    for row, line in enumerate(lines):
        content.append(f"BT /F1 12 Tf 60 {720 - 20 * row} Td ({escape(line)}) Tj ET")
    stream = "\n".join(content).encode("latin-1", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref_at = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref_at)
    return bytes(out)


def seed() -> int:
    """Upload every sample through the same path a browser uses. Returns the count."""
    service = get_service()
    for title, subject, semester, kind, tags, uploader in SAMPLES:
        email = uploader.lower().replace(" ", ".") + "@" + DEFAULT_EMAIL_DOMAIN
        user = User(id="seed-" + email, email=email, name=uploader)
        body = make_pdf(title, [f"{subject} - semester {semester}", f"Shared by {uploader}", "Sample file for local mode."])
        created = service.create_upload(
            user,
            {
                "title": title,
                "fileName": title.lower().replace(" - ", "-").replace(" ", "-") + ".pdf",
                "size": len(body),
                "subjectCode": subject,
                "semester": semester,
                "resourceType": kind,
                "tags": tags,
                "description": "Sample file added by local mode.",
            },
        )
        form = created["upload"]
        requests.post(form["url"], data=form["fields"], files={"file": ("upload", body)}, timeout=10).raise_for_status()
        service.complete_upload(user, created["file"]["fileId"])
    return len(SAMPLES)
