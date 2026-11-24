# CloudDrop

A cloud-hosted library where Thapar students share notes, lab manuals, slides
and question papers. UCS531 Cloud Computing project, Thapar Institute of
Engineering and Technology.

**Live on Google Cloud (Firebase Hosting):** https://clouddrop-473512.web.app
**Mirror on Vercel:** https://clouddrop-five.vercel.app
**Source:** https://github.com/govinda16293/CloudDrop

Students sign in with their `@thapar.edu` e-mail, upload a file once, tag it with
its subject code, semester and type, and everyone on campus can find it next
semester too. There is no server to maintain: hosting, sign-in, database and
file storage are all managed cloud services, on free tiers.

## Features

| Area | What students can do |
|---|---|
| Accounts | Sign up and sign in with a campus e-mail only, confirm by e-mail, reset a forgotten password |
| Upload | Drag and drop a PDF, Word or PowerPoint file (up to 25 MB), with title, subject code, semester, type, tags and description |
| Auto-fill | A PDF is read by the analyser on Azure App Service, which fills in page count, subject code and suggested tags |
| Library | Search title, tags, file name and uploader; filter by subject, semester and type; sort by newest, most downloaded or title |
| Shortcuts | One-click popular-subject filters and live totals (files, subjects, downloads) |
| Sharing | Every search lives in the address (`#/library?subject=UCS531`), so a link opens the same results |
| Files | Open PDFs and images in the browser, download any file through a 5-minute signed link, see download counts |
| Saved | Save files to a personal list |
| Live updates | New and removed files appear in every open Library instantly, with no refresh (Supabase Realtime) |
| Reports | Flag a file as wrong subject, broken, duplicate or inappropriate |
| My uploads | See and delete your own files |
| Dashboard (admins) | Totals, files and downloads by subject, type and semester, most downloaded, latest uploads, reports to review (dismiss or remove the file), and a recent-activity log |

## Architecture

The app runs across three clouds. Google Cloud (Firebase Hosting) serves the React app, with Vercel as a mirror; Azure App Service runs the PDF analyser; the
browser then talks to Supabase directly, and Supabase checks every request
against the user's token and the database's Row Level Security rules.

```mermaid
flowchart LR
    U[Student browser<br/>React + Tailwind<br/>supabase-js]
    V[Firebase Hosting / Vercel<br/>static build, global CDN, HTTPS]
    G[Gmail SMTP<br/>confirm and reset e-mails]
    subgraph S["Supabase, AWS ap-south-1 (Mumbai)"]
        A[Auth<br/>@thapar.edu only, JWT]
        P[(PostgreSQL<br/>profiles, files, bookmarks,<br/>reports, activity<br/>Row Level Security)]
        ST[(Storage<br/>private bucket 'resources')]
        R[Realtime<br/>changes to files]
    end
    AZ[Azure App Service<br/>PDF analyser]
    U -- "1. load app" --> V
    U -- "PDF + JWT" --> AZ
    AZ -. "verify session" .-> A
    U -- "2. sign in" --> A
    A -- "e-mails" --> G
    U -- "3. queries + JWT" --> P
    U == "4. upload, signed download" ==> ST
    R -. "5. live updates" .-> U
```

### Two deployments, one code base

| Concern | Live (Vercel + Supabase) | Alternate design (AWS SAM, in this repo) |
|---|---|---|
| Hosting and CDN | Vercel | S3 + CloudFront |
| Sign-in | Supabase Auth + database trigger | Cognito + pre-sign-up Lambda |
| Application logic | Browser + Row Level Security + SQL functions | API Gateway + Python Lambda |
| File details | Supabase PostgreSQL | DynamoDB |
| Files | Private Supabase Storage, signed URLs | Private S3, pre-signed URLs |
| Monitoring | Activity log written by database triggers | CloudWatch logs, metrics, dashboard |

The live version moved to Vercel and Supabase while AWS account verification
was pending. The AWS version is complete and tested locally against mocked AWS
services (see [What has been verified](#what-has-been-verified)). The frontend
picks its backend at start-up: Supabase when its build variables are set,
otherwise `/config.json` (local or AWS mode). See
[docs/LIVE_DEPLOYMENT.md](docs/LIVE_DEPLOYMENT.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Cloud computing concepts (UCS531)

| Topic | Where it appears |
|---|---|
| Service models | Vercel (PaaS) hosts the app; Supabase is backend-as-a-service; students use CloudDrop as SaaS |
| Serverless computing | No provisioned servers; the AWS design uses Lambda behind API Gateway |
| Object storage | Files in a private storage bucket, moved directly between browser and storage |
| Cloud databases | Managed PostgreSQL (DynamoDB in the AWS design) |
| Identity and access management | Domain-restricted sign-up, JWT sessions, Row Level Security, least-privilege SQL functions |
| Content delivery | Google's Firebase Hosting CDN and Vercel's edge network (CloudFront in the AWS design) |
| Multi-cloud | Google (hosting), Microsoft Azure (PDF analysis on App Service), Supabase on AWS (auth, database, storage) |
| Event-driven design | Database triggers write the activity log; Realtime pushes table changes to browsers |
| Elasticity and pay-per-use | Free tiers that scale with traffic and cost nothing when idle |
| Multi-tenancy | One database and bucket for all students, separated by per-user policies |
| Monitoring | Admin dashboard and activity log (CloudWatch in the AWS design) |

## Security

- Sign-up only for `@thapar.edu` addresses, checked in the browser and by a database trigger; e-mail confirmation required.
- Row Level Security on every table: signed-in users read the library; users change only their own files, bookmarks and reports; only admins see reports and the activity log.
- The `resources` bucket is private; every preview or download uses a signed URL that expires after 300 seconds.
- The browser holds only the public (anon) key. Counting downloads and writing the activity log run in `security definer` functions that do one thing each.
- All traffic is HTTPS. Supabase's security advisor reported no warnings.

## Set up the live version

1. **Supabase project** with `profiles` and `files` tables and a private
   `resources` bucket (created in the Supabase dashboard).
2. **Extra features:** run [`supabase/features.sql`](supabase/features.sql)
   once in the SQL Editor. It adds `bookmarks`, `reports` and `activity` with
   Row Level Security, the activity triggers, the download counter, and
   Realtime on `files`. Until it is run, the app hides those features.
3. **Make an admin:**
   ```sql
   update public.profiles set is_admin = true where email = 'name@thapar.edu';
   ```
4. **Auth settings** (Authentication → URL Configuration): Site URL
   `https://clouddrop-five.vercel.app`, Redirect URL
   `https://clouddrop-five.vercel.app/**`.
5. **E-mail** (Authentication → Emails → SMTP Settings): a Gmail account with
   an App Password (`smtp.gmail.com`, port 465), then raise the e-mail rate
   limit under Authentication → Rate Limits. The built-in sender allows only
   about 2 e-mails an hour.
6. **Vercel:** project root directory `frontend`, with environment variables
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Deploy from the
   repository root:
   ```bash
   npx vercel --prod
   ```

## Run it on your computer (no cloud account needed)

You need Python 3.11+ and Node.js 20+.

```bash
make setup
```

```bash
make dev
```

Open http://localhost:5173 and sign in with any `@thapar.edu` address (local
mode has no passwords). Tick "Sign in as an admin" to see the dashboard.
Local mode runs the AWS version's Lambda code against mocked AWS (the `moto`
library); data is gone when you stop it. Saved files, reports, the activity log
and live updates exist only in the Supabase version.

## Deploy the AWS version

```bash
./scripts/deploy.sh
```

Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) first: what to install, how to
make an admin, what it costs and how to delete it all.

## Tests

```bash
make test
```

| Check | What it covers |
|---|---|
| 90 frontend tests (`vitest`) | REST and Supabase API clients, saved files, reports, activity log, live updates, download counting, upload rules, sign-in logic |
| 241 backend tests (`pytest`) | Validation, DynamoDB and S3 access, every API route, permissions, local mode over real HTTP |
| `cfn-lint` | The CloudFormation/SAM template |
| IAM coverage test | Records every AWS call the code makes and checks the template's policy allows it |

## Tech stack

React 18, Vite, Tailwind CSS v4, `@supabase/supabase-js`, Supabase (Auth,
PostgreSQL, Storage, Realtime), Vercel. AWS design: Python 3.13 Lambda, API
Gateway, Cognito, DynamoDB, S3, CloudFront, CloudWatch, AWS SAM.

## What is where

| Path | What it is |
|---|---|
| `frontend/` | The React app (Vite, Tailwind) |
| `frontend/src/lib/api.js` | API clients: REST (AWS and local) and Supabase |
| `frontend/src/lib/auth/supabase.js` | Supabase sign-in, sign-up and password reset |
| `frontend/src/views/` | Sign-in, Library, Upload, Dashboard screens |
| `frontend/public/` | Campus photos used as backgrounds |
| `supabase/features.sql` | Saved files, reports, activity log, download counter, Realtime |
| `backend/src/clouddrop/` | The AWS Lambda code (Python, no third-party packages) |
| `backend/tests/` | Backend tests |
| `infra/template.yaml` | Every AWS resource, as one AWS SAM template |
| `local/` | Local mode: mocked AWS, API Gateway stand-in, sample data |
| `loadtest/loadtest.py` | Load test script |
| `scripts/deploy.sh` | One-command AWS deploy |
| `docs/LIVE_DEPLOYMENT.md` | The live Vercel + Supabase deployment |
| `docs/GOOGLE_CLOUD.md` | Firebase Hosting and the PDF analyser (Azure App Service / Cloud Run) |
| `cloud-run/analyzer/` | PDF analyser (Node): reads a PDF, returns pages, words, subject code and tags; runs on Azure App Service |
| `docs/ARCHITECTURE.md` | The AWS design and its syllabus mapping |
| `docs/DEPLOYMENT.md` | Deploy, operate and delete the AWS version |
| `docs/SERVERLESS_VS_EC2.md` | Serverless vs an EC2-hosted version, with cost analysis |
| `docs/SUBMISSION_READINESS.md` | Submission checklist |

## What has been verified

- **Live (Vercel + Supabase):** sign-up, sign-in, upload, search, filters,
  sort, preview, download, delete, saved files, reports, activity log and live
  updates work at https://clouddrop-five.vercel.app. Gmail SMTP is configured
  for confirmation and reset e-mails.
- **Locally:** all tests above pass; the full flow was run in a browser in
  local mode, and a downloaded file matched the upload byte for byte.
- **Not verified:** the AWS stack has not been deployed to a real AWS account.
  The template passes `cfn-lint` and `sam build`, and the IAM test guards
  permissions, but the first real deploy may still surface an issue.

## Team

| Name | Roll number |
|---|---|
| Ashish Bajaj | 1024030096 |
| Govind | 1024030968 |

Lab group: _add_ · Advisor: Anil Singh
