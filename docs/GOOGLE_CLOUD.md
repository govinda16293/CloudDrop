# CloudDrop on Google Cloud

Live: https://clouddrop-473512.web.app (project `clouddrop-473512`).

Status: Firebase Hosting is deployed. The Cloud Run analyser is written and
tested but not yet deployed, because Cloud Run needs an active billing account
and Google declined billing setup for the college account (`OR_BACR2_59`).
Until `VITE_ANALYZER_URL` is set, the Upload page works without it.

Two Google Cloud services carry part of CloudDrop:

| Service | What it does |
|---|---|
| Firebase Hosting (Google's CDN) | Serves the React app over HTTPS |
| Cloud Run (`cloud-run/analyzer`) | Reads a PDF the student is about to upload and returns its page count, word count, a subject code found in the text and suggested tags; the Upload form fills itself in |

Supabase still provides sign-in, the database and file storage. The analyser
accepts only requests carrying a valid Supabase session for an `@thapar.edu`
account, checks that the body is a PDF of at most 25 MB, and stores nothing.
It scales to zero when idle and runs one container per burst of requests.

## One-time setup

```bash
gcloud auth login
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
firebase login
```

## Deploy the analyser to Cloud Run

From `cloud-run/analyzer` (Cloud Build turns the source into a container; no Docker needed):

```bash
gcloud run deploy clouddrop-analyzer --source . --region asia-south1 --allow-unauthenticated --memory 512Mi --max-instances 3 --set-env-vars SUPABASE_URL=...,SUPABASE_PUBLISHABLE_KEY=...,ALLOWED_ORIGINS=https://PROJECT_ID.web.app,https://clouddrop-five.vercel.app
```

`--allow-unauthenticated` lets the browser reach it; the service itself checks
the Supabase session on every call. Note the service URL it prints.

## Deploy the app to Firebase Hosting

From `frontend`, with `.env.production.local` holding `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_ANALYZER_URL=<Cloud Run URL>`:

```bash
npm run build
firebase deploy --only hosting --project PROJECT_ID
```

Then add `https://PROJECT_ID.web.app/**` to the Supabase Redirect URLs.

## Tests

```bash
cd cloud-run/analyzer && npm test
```
