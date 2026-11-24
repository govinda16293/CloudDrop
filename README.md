# CloudDrop

A serverless campus notes and resource sharing platform on AWS.
UCS531 Cloud Computing project, Thapar Institute of Engineering and Technology.

Students sign in with their college e-mail, upload notes, lab manuals, question
papers and slides, tag them with subject code, semester and type, and search or
download what others shared. There is no server to maintain and almost no cost
when nobody is using it.

**Live demo:** https://clouddrop-five.vercel.app (Vercel + Supabase, see
[docs/LIVE_DEPLOYMENT.md](docs/LIVE_DEPLOYMENT.md)).
**Source:** _add GitHub URL here_

```
Browser ──> CloudFront ──┬──> S3 (React site)
                         └──> API Gateway ──> Lambda (Python) ──┬──> DynamoDB (file details)
                                   ▲                            └──> S3 (the files, by pre-signed URL)
                              Cognito (login)                CloudWatch (logs, metrics, dashboard)
```

## Run it on your computer (no AWS account needed)

You need Python 3.11+ and Node.js 20+.

```bash
make setup
```

If your `python3` is older than 3.11, name a newer one: `make setup PYTHON=python3.13`.

```bash
make dev
```

Open http://localhost:5173 and sign in with any `@thapar.edu` address (local
mode has no passwords). Tick "Sign in as an admin" to see the dashboard.

Local mode runs the **same Lambda code** against a mock AWS (the `moto`
library) that keeps an S3 bucket and a DynamoDB table in memory. A small
stand-in for API Gateway (`local/server.py`) turns each request into the same
event the real one sends. Data is gone when you stop it.

## Deploy it to AWS

```bash
./scripts/deploy.sh
```

This creates everything in your AWS account and prints the live address.
Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) first: it lists what to install,
how to make an admin, what it costs and how to delete it all.

## Check it

```bash
make test
```

| Check | What it covers |
|---|---|
| 241 backend tests (`pytest`) | Validation, DynamoDB and S3 access, every API route, permissions, local mode over real HTTP |
| 81 frontend tests (`vitest`) | API client, upload rules, sign-in logic (local and Cognito) |
| `cfn-lint` | The CloudFormation/SAM template |
| IAM coverage test | Records every AWS call the code makes and checks the template's policy allows it |

## What is where

| Path | What it is |
|---|---|
| `infra/template.yaml` | Every AWS resource, as one AWS SAM template |
| `backend/src/clouddrop/` | The Lambda code (Python, no third-party packages) |
| `backend/tests/` | Backend tests |
| `frontend/` | The React site (Vite) |
| `local/` | Local mode: mock AWS + API Gateway stand-in + sample data |
| `loadtest/loadtest.py` | Load test script |
| `scripts/deploy.sh` | One-command deploy |
| `docs/LIVE_DEPLOYMENT.md` | The live Vercel + Supabase deployment |
| `docs/ARCHITECTURE.md` | How it works, and how it maps to the syllabus |
| `docs/DEPLOYMENT.md` | Deploy, operate, delete |
| `docs/SERVERLESS_VS_EC2.md` | Report: serverless vs an EC2-hosted version, with cost analysis |

## What has and has not been verified

- **Verified:** all tests above pass; the full flow (sign in, upload, search,
  download, delete, admin dashboard) was exercised in a browser in local mode;
  a browser-uploaded file was downloaded back byte-for-byte identical.
- **Verified (live):** the Vercel + Supabase deployment builds and serves the
  app at https://clouddrop-five.vercel.app.
- **Not verified:** the AWS stack has **not been deployed to real AWS** by the
  author. The template passes `cfn-lint` and `sam build`, and the IAM test
  guards permissions, but the first real deploy may still surface an issue.
  The Cognito sign-in code was run with the real Cognito library against a
  mock Cognito (sign-up, "confirm your e-mail" error, sign-in, ID token,
  sign-out), but never against a live user pool, and the mock does not check
  passwords.

## Team

| Name | Roll number |
|---|---|
| Ashish Bajaj | _add_ |
| Govind | _add_ |
| Pushp Batheja | _add_ |

Lab group: _add_ · Advisor: Anil Singh
