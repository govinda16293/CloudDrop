#!/usr/bin/env python3
"""Load test for CloudDrop. Standard library only.

Local mode (start it first with `make dev`):
    python loadtest/loadtest.py --base http://127.0.0.1:8787 --requests 500 --concurrency 25

Deployed site (ID token: sign in on the site, then DevTools > Application >
Local Storage > the key that ends in ".idToken"):
    python loadtest/loadtest.py --base https://dxxxx.cloudfront.net --token eyJ... --requests 2000 --concurrency 50

Traffic mix, modelled on exam week: mostly browsing and searching, some
downloads. A "download" asks the API for a link; it does not fetch the file,
because file bytes are served by S3 and never touch API Gateway or Lambda.
"""

import argparse
import base64
import json
import random
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

SEARCH_WORDS = ["notes", "unit", "cloud", "lab", "paper", "lambda", "2025", "slides"]
SUBJECTS = ["UCS531", "UCS310", "UCS303", "UMA010"]


def local_token(email: str) -> str:
    payload = json.dumps({"email": email, "name": "Load Test", "admin": False}).encode()
    return "local." + base64.urlsafe_b64encode(payload).decode().rstrip("=")


def call(base: str, token: str, path: str):
    """Returns (status, seconds, parsed body or None). Status 0 means no response."""
    request = urllib.request.Request(base + path, headers={"Authorization": token})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read())
            return response.status, time.perf_counter() - started, body
    except urllib.error.HTTPError as error:
        error.read()
        return error.code, time.perf_counter() - started, None
    except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
        return 0, time.perf_counter() - started, None


def pick_request(rng: random.Random, file_ids: list[str]):
    roll = rng.random()
    if roll < 0.45:
        return "list", "/api/files?limit=12"
    if roll < 0.65:
        return "list by subject", f"/api/files?subject={rng.choice(SUBJECTS)}"
    if roll < 0.85:
        return "search", f"/api/files?q={rng.choice(SEARCH_WORDS)}"
    if roll < 0.95 and file_ids:
        return "download link", f"/api/files/{rng.choice(file_ids)}/download"
    return "me", "/api/me"


def percentile(sorted_values: list[float], fraction: float) -> float:
    index = min(len(sorted_values) - 1, int(round(fraction * (len(sorted_values) - 1))))
    return sorted_values[index]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, help="site or API address, without /api")
    parser.add_argument("--token", help="Cognito ID token (omit for local mode)")
    parser.add_argument("--requests", type=int, default=500)
    parser.add_argument("--concurrency", type=int, default=25)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    base = args.base.rstrip("/")
    token = args.token or local_token("loadtest@thapar.edu")
    status, _, listing = call(base, token, "/api/files?limit=50")
    if status != 200:
        print(f"Could not reach {base}/api/files (status {status}). Is it running, and is the token valid?")
        return 1
    file_ids = [item["fileId"] for item in listing["items"]]
    print(f"Target {base} | {len(file_ids)} files found | {args.requests} requests, {args.concurrency} at a time")

    rng = random.Random(args.seed)
    plan = [pick_request(rng, file_ids) for _ in range(args.requests)]
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(lambda item: (item[0], *call(base, token, item[1])[:2]), plan))
    elapsed = time.perf_counter() - started

    timings, statuses = defaultdict(list), Counter()
    for kind, status, seconds in results:
        statuses[status] += 1
        if status == 200:
            timings[kind].append(seconds * 1000)

    print(f"\n{'request':<18}{'count':>7}{'p50 ms':>9}{'p95 ms':>9}{'p99 ms':>9}{'max ms':>9}")
    everything = []
    for kind in sorted(timings):
        values = sorted(timings[kind])
        everything += values
        print(f"{kind:<18}{len(values):>7}{statistics.median(values):>9.1f}{percentile(values, 0.95):>9.1f}"
              f"{percentile(values, 0.99):>9.1f}{values[-1]:>9.1f}")
    if everything:
        everything.sort()
        print(f"{'ALL':<18}{len(everything):>7}{statistics.median(everything):>9.1f}{percentile(everything, 0.95):>9.1f}"
              f"{percentile(everything, 0.99):>9.1f}{everything[-1]:>9.1f}")

    failed = args.requests - statuses[200]
    print(f"\n{args.requests / elapsed:.0f} requests/second over {elapsed:.1f} s")
    print("status codes: " + ", ".join(f"{code or 'no response'}: {count}" for code, count in sorted(statuses.items())))
    if statuses[429]:
        print("429 means API Gateway throttled the request: the stage limit is 25 requests/second (burst 50).")
    print(f"failed: {failed} of {args.requests}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
