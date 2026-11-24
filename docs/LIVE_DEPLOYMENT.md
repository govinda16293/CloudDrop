# CloudDrop live deployment (Vercel + Supabase)

Live site: https://clouddrop-five.vercel.app

The AWS SAM stack in `infra/template.yaml` is the primary design (see
[ARCHITECTURE.md](ARCHITECTURE.md)). While AWS account verification was
pending, the same React app was deployed on managed cloud platforms so a
working version is always available. Supabase's project runs in AWS region
`ap-south-1` (Mumbai).

## Diagram

```mermaid
flowchart LR
    U[Student browser<br/>React app]

    subgraph VERCEL["Vercel"]
        CDN[Global CDN<br/>HTTPS, static React build]
    end

    subgraph SUPA["Supabase, AWS ap-south-1"]
        AUTH[Supabase Auth<br/>e-mail + password, @thapar.edu only]
        TRG[DB trigger<br/>create profile, check domain]
        PG[(PostgreSQL<br/>profiles, files<br/>Row Level Security)]
        ST[(Storage bucket 'resources'<br/>private)]
    end

    U -- "1. load site" --> CDN
    U -- "2. sign up / sign in" --> AUTH
    AUTH -. "on new user" .-> TRG --> PG
    U -- "3. query metadata + JWT" --> PG
    U == "4. upload file" ==> ST
    U == "5. download, 5-minute signed URL" ==> ST
```

## Components

| Concern | AWS design | Live deployment |
|---|---|---|
| Static hosting + CDN | S3 + CloudFront | Vercel |
| Login | Cognito user pool + pre sign-up Lambda | Supabase Auth + database trigger |
| File metadata | DynamoDB via Lambda | Supabase PostgreSQL (`profiles`, `files`) |
| File storage | Private S3, pre-signed URLs | Private Supabase Storage, signed URLs |
| Access control | API Gateway Cognito authorizer + IAM | Row Level Security policies |

## Security

- Row Level Security on every table: only signed-in users can read; users can
  insert and delete only their own rows.
- The `resources` bucket is private. Downloads use signed URLs valid for 300 s.
- Sign-up is limited to `@thapar.edu` addresses (checked in the browser and by
  a database trigger).
- Only the publishable (anon) key is shipped to the browser; it is supplied to
  the Vercel build as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- The Supabase security advisor reported no warnings.

## How the frontend chooses a backend

`frontend/src/lib/config.js`: if the Supabase build variables are set, the app
runs in `supabase` mode (`frontend/src/lib/auth/supabase.js`,
`frontend/src/lib/api.js`). Otherwise it loads `/config.json` and runs in
`local` or `cognito` (AWS) mode.

## Required Supabase setting

Authentication → URL Configuration:

| Field | Value |
|---|---|
| Site URL | `https://clouddrop-five.vercel.app` |
| Redirect URLs | `https://clouddrop-five.vercel.app/**` |
