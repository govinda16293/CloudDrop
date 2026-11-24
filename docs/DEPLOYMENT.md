# Deploying CloudDrop to AWS

> The author built and tested CloudDrop in local mode and with `cfn-lint` and
> `sam build`, but has **not deployed it to a real AWS account**. Treat the
> first deploy as a test: read the output, and see "If something fails" below.

## 1. What you need

| Tool | Why | Check |
|---|---|---|
| An AWS account | Where it runs. Free tier or AWS Educate credits are enough. | |
| AWS CLI v2 | Talks to AWS | `aws --version` |
| AWS SAM CLI | Builds and deploys the template | `sam --version` |
| Python 3.13 | SAM builds the Lambda package with it | `python3.13 --version` |
| Node.js 20+ | Builds the site | `node --version` |

No Python 3.13? Either install it, or change `Runtime: python3.13` in
`infra/template.yaml` to the version you have (3.11 or newer).

Set up credentials once:

```bash
aws configure
```

Use an IAM user or role that may create CloudFormation stacks, S3 buckets,
Lambda functions, API Gateway, DynamoDB, Cognito, CloudFront, CloudWatch and
IAM roles. For a student account, `AdministratorAccess` is the simple choice.
Do not use the root user's access keys.

## 2. Deploy

```bash
./scripts/deploy.sh
```

It does four things:

1. `sam build` — packages the Lambda code.
2. `sam deploy` — creates the stack (about 10 minutes the first time; CloudFront is slow).
3. Builds the site and writes `config.json` with your Cognito IDs.
4. Uploads the site to S3 and clears the CloudFront cache.

At the end it prints the live address.

Settings (all optional):

```bash
STACK_NAME=clouddrop AWS_REGION=ap-south-1 EMAIL_DOMAIN=thapar.edu MAX_FILE_MB=25 ./scripts/deploy.sh
```

`STACK_NAME` must be lower case (it becomes part of an S3 bucket name).

Each student can keep up to 200 files. To change that, edit the default of
`MaxFilesPerUser` in `infra/template.yaml` and deploy again.

Run the same command again any time to ship a change.

## 3. Make an admin

Sign up on the site first, then:

```bash
aws cognito-idp admin-add-user-to-group --region ap-south-1 --user-pool-id YOUR_POOL_ID --group-name admins --username YOUR_EMAIL
```

The deploy script prints this command with your pool ID filled in. Sign out and
in again; the "Dashboard" tab appears.

## 4. Check it works

1. Open the site address. Create an account with your college e-mail.
2. Try a Gmail address: sign-up must be refused.
3. Enter the code from the e-mail, sign in.
4. Upload a PDF. Find it by subject code and by a word in the title.
5. Download it. The download count goes up.
6. Sign in as a second user: there is no Delete button on the first user's file.
7. As an admin, open Dashboard.
8. Open the CloudWatch dashboard link the deploy script printed.

## 5. Load test

Sign in on the site. In the browser's developer tools open
Application → Local Storage and copy the value of the key ending in `.idToken`.

```bash
python3 loadtest/loadtest.py --base https://YOUR_SITE.cloudfront.net --token PASTE_TOKEN --requests 2000 --concurrency 50
```

The API is throttled at 25 requests/second (burst 50), so a hard test will
show some `429` answers. That is the throttle working. To test higher, raise
`ThrottlingRateLimit` and `ThrottlingBurstLimit` in `infra/template.yaml`.
Record the numbers in `docs/SERVERLESS_VS_EC2.md`, section 6.

## 6. What it costs

With little traffic, close to nothing: every service used bills per request or
per GB stored, and most have a free allowance. See
`docs/SERVERLESS_VS_EC2.md` for the working. Set a budget alarm anyway:
AWS Console → Billing → Budgets → "Zero spend budget".

## 7. Delete everything

Buckets must be empty before CloudFormation can delete them, and the files
bucket is versioned, so empty the old versions too.

```bash
aws s3 rm s3://SITE_BUCKET_NAME --recursive
```

For the files bucket, the simplest way is the S3 console: select the bucket →
**Empty**. Then:

```bash
sam delete --stack-name clouddrop --region ap-south-1
```

## 8. If something fails

| Symptom | Likely cause | Fix |
|---|---|---|
| `sam build` says Python 3.13 not found | Runtime not installed locally | Install it, or use `sam build --use-container` (needs Docker), or change `Runtime` |
| Stack fails on `FilesBucket` "already exists" | Bucket names are global; the name is `<stack>-files-<account id>` | Use a different `STACK_NAME` |
| Stack fails and rolls back | See the first `CREATE_FAILED` row | `aws cloudformation describe-stack-events --stack-name clouddrop --region ap-south-1` |
| Site shows "could not start" | `config.json` missing or cached | Re-run the deploy script; it rewrites the file and clears the cache |
| Every API call is 401 | Token expired, or the site is sending a token from a different user pool | Sign out and in |
| Upload fails at the storage step | Bucket CORS does not match the site address | CORS allows only the CloudFront address; do not open the site from the S3 address |
| Sign-up e-mails stop arriving | Cognito's built-in sender allows about 50 e-mails a day | Wait a day, or connect Amazon SES |
| Admin dashboard says metrics unavailable | CloudWatch call failed | Check the `<stack>-admin` function's log group |

Find any error in the logs:

```bash
sam logs --stack-name clouddrop --region ap-south-1 --tail
```
