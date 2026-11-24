# CloudDrop on Google Cloud

Live: https://clouddrop-473512.web.app (project `clouddrop-473512`).

Status: the app is deployed on Firebase Hosting. The PDF analyser is deployed on
**Azure App Service** (free F1 plan, Central India) at
https://clouddrop-analyzer-gp24.azurewebsites.net, because Google declined billing
setup for the college account (`OR_BACR2_59`) and Cloud Run needs billing. The
same code also deploys to Cloud Run with the command below once billing is active.

## Deploy the analyser to Azure App Service (what runs today)

```bash
az group create --name clouddrop-rg --location centralindia
az appservice plan create --name clouddrop-plan --resource-group clouddrop-rg --location centralindia --sku F1 --is-linux
az webapp create --name clouddrop-analyzer-gp24 --resource-group clouddrop-rg --plan clouddrop-plan --runtime "NODE:22-lts"
az webapp config appsettings set --name clouddrop-analyzer-gp24 --resource-group clouddrop-rg --settings SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... ALLOWED_ORIGINS=https://clouddrop-473512.web.app,https://clouddrop-five.vercel.app SCM_DO_BUILD_DURING_DEPLOYMENT=false
az webapp config set --name clouddrop-analyzer-gp24 --resource-group clouddrop-rg --startup-file "node server.js"
az webapp deploy --name clouddrop-analyzer-gp24 --resource-group clouddrop-rg --src-path analyzer.zip --type zip
```

Build `analyzer.zip` from `server.js`, `package.json`, `package-lock.json` and
`node_modules` with forward-slash paths (Windows PowerShell 5.1's
`Compress-Archive` writes backslashes, which the Linux host rejects).

Cloud services that carry part of CloudDrop:

| Service | What it does |
|---|---|
| Firebase Hosting (Google's CDN) | Serves the React app over HTTPS |
| Azure App Service, or Google Cloud Run (`cloud-run/analyzer`) | Reads a PDF the student is about to upload and returns its page count, word count, a subject code found in the text and suggested tags; the Upload form fills itself in |

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

## Deploy the analyser to Google Cloud Run (needs billing)

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
