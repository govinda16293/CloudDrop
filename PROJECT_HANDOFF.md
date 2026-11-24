# CloudDrop — Project Handoff

Last updated: 24 November 2026

## Project

CloudDrop is a campus resource-sharing web application for notes, lab manuals, question papers, slides, and other academic material. It supports university e-mail accounts, searchable file metadata, uploads, private file storage, downloads, and an admin dashboard.

## Team and course alignment

- Intended course: UCS531 — Cloud Computing.
- The project has a meaningful cloud component: Vercel hosting/CDN plus Supabase Authentication, PostgreSQL database, Row Level Security, and private object storage.
- It is suitable for the requested deliverables: proposal, architecture, implementation, cloud deployment, source code, report, presentation, and live demonstration.

## What was completed

### Existing AWS implementation reviewed

The repository already included an AWS/SAM implementation:

- Python AWS Lambda backend.
- API Gateway/Cognito/S3/DynamoDB-style serverless architecture.
- React/Vite frontend.
- SAM infrastructure template and supporting documentation.

Local verification completed before the migration:

- Backend tests: **241 passed**.
- Frontend tests: **81 passed**.
- Frontend production build: passed.

### Deployment path selected

AWS account/cloud-environment verification was not ready for immediate deployment. To allow a free working demonstration, the live version was moved to:

- **Vercel** for frontend hosting and CDN.
- **Supabase** for authentication, database, and private file storage.

This is still a cloud-native deployment and can be presented as the working deployment. The original AWS/SAM implementation remains in the repository as an alternate serverless architecture.

### Supabase project created and configured

Supabase project:

- Name: `clouddrop`
- Region: `ap-south-1`
- Project reference: `ijzsltrchzkgzfcsymua`

Configured database structure:

- `profiles`: user e-mail, name, role, and creation time.
- `files`: file metadata, subject code, semester, tags, uploader, storage path, download count, and timestamps.
- Private `resources` storage bucket for uploaded academic files.

Security implemented:

- Row Level Security is enabled on application tables.
- Only authenticated users can read campus material.
- Users can upload and delete their own files.
- Storage is private and downloads use short-lived signed URLs.
- A trigger creates a profile for a confirmed user and restricts registration to `@thapar.edu` addresses.
- Supabase security advisor was run and reported no security warnings.

### Frontend migrated to Supabase

The React frontend was updated to use Supabase in the deployed environment:

- E-mail/password sign-up and sign-in.
- Campus-domain validation (`@thapar.edu`).
- Password-reset flow.
- Supabase PostgreSQL file metadata.
- Supabase private Storage uploads.
- Search, filtering, pagination, deletion, and signed downloads.
- Dashboard data from stored file metadata.
- The old AWS/local configuration path remains available in the same source tree.

The official `@supabase/supabase-js` package was added and locked in the frontend dependencies.

### UI direction

The app UI uses a restrained academic-library style:

- Paper/ink/gold visual palette rather than gradients.
- Clear editorial typography and compact navigation.
- Structured library cards, filters, upload area, and dashboard.
- Responsive layout and accessible visible-focus states.

### Loading-screen bug fixed

Two startup issues were found and fixed:

1. Startup depended on an online Auth user-validation request, which could hang for a signed-out visitor.
2. A signed-out (`401`) state did not switch the interface to the sign-in screen.

The current production deployment includes both fixes.

## Deployment

Production URL:

- https://clouddrop-five.vercel.app

Vercel project:

- Team: `gobinda1`
- Project: `clouddrop`
- Deployment status at handoff: **Ready**.

Verification completed:

- Vercel production build completed successfully.
- Frontend production build passed locally.
- Frontend test suite: **81 tests passed**.
- Public HTTP request to the production URL returned **200 OK**.

## Required one-time action: Supabase confirmation redirect

E-mail confirmation currently redirects to `localhost`, because the Supabase Auth URL configuration still has its default Site URL.

In Supabase Dashboard, open the `clouddrop` project and set:

**Authentication → URL Configuration**

| Field | Value |
| --- | --- |
| Site URL | `https://clouddrop-five.vercel.app` |
| Redirect URLs | `https://clouddrop-five.vercel.app/**` |

Save the settings, then resend the confirmation e-mail or create the account again. The confirmation link will return to the live app instead of `localhost`.

## Demonstration script

1. Open `https://clouddrop-five.vercel.app`.
2. Create an account with a Thapar e-mail address.
3. Confirm the e-mail after the Supabase redirect configuration above is saved.
4. Sign in.
5. Upload a small PDF with a subject code such as `UCS531`.
6. Show the file in the Library.
7. Search by subject, tag, or title.
8. Download the resource.
9. Explain that Vercel hosts the frontend, Supabase Auth manages users, PostgreSQL stores metadata, and private Supabase Storage keeps documents secure.

## Remaining academic deliverables

- Publish the source code to GitHub or an equivalent repository.
- Prepare the maximum five-page report.
- Prepare final presentation slides.
- Capture screenshots of the deployed app, Supabase tables/storage, and Vercel deployment for evidence.
- If a publicly accessible demonstration is required, review Vercel Deployment Protection; the current production deployment reports Vercel Authentication protection.

## Key repository locations

- `frontend/` — React/Vite application.
- `frontend/src/lib/auth/supabase.js` — Supabase authentication integration.
- `frontend/src/lib/api.js` — Supabase-backed application data API.
- `backend/` — original Python/AWS Lambda backend.
- `infra/template.yaml` — original AWS SAM infrastructure.
- `docs/SUBMISSION_READINESS.md` — submission checklist.
- `docs/ARCHITECTURE.md` — original AWS architecture notes.

