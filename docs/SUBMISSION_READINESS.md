# CloudDrop submission readiness

This checklist turns the UCS531 project requirements into verifiable evidence.
Complete each unchecked item before final submission.

## Verified locally

- [x] Three-member team recorded in the project proposal.
- [x] CloudDrop title explicitly maps to UCS531 topics: service models, serverless computing, object storage, NoSQL, IAM, CDN, monitoring, and elasticity.
- [x] Project proposal includes a problem statement, objectives, AWS design, implementation plan, and architecture diagram.
- [x] Working application supports sign-in, upload, search, download, deletion, and an admin dashboard in local mode.
- [x] Backend test suite: 241 tests passed on 24 November 2026.
- [x] Frontend test suite: 81 tests passed on 24 November 2026.
- [x] Production frontend build succeeds on 24 November 2026.
- [x] Architecture, deployment instructions, and a serverless-versus-EC2 comparison are documented.

## Live deployment (Vercel + Supabase)

- [x] Frontend deployed to Vercel: https://clouddrop-five.vercel.app
- [x] Supabase Auth, PostgreSQL (RLS) and private Storage configured.
- [ ] Set Supabase Site URL and Redirect URLs to the Vercel address.
- [ ] Rehearse: sign up, confirm e-mail, off-domain rejection, upload, search, download, delete.
- [ ] Screenshots: live app, Supabase tables, storage bucket, auth users, Vercel deployment.

## Before AWS deployment (optional, if AWS access becomes available)

- [ ] Install AWS CLI v2 and AWS SAM CLI on the deployment computer.
- [ ] Configure a non-root AWS IAM identity with permission to create the documented stack resources.
- [ ] Confirm the account has AWS Free Tier eligibility or AWS Educate/student credits.
- [ ] Choose the final stack name and AWS region. The documented default is `clouddrop` in `ap-south-1`.
- [ ] Run `sam build` and `cfn-lint infra/template.yaml`.

## AWS deployment evidence

- [ ] Run `scripts/deploy.sh` successfully and record the live CloudFront URL.
- [ ] Sign up with a valid institute e-mail and complete e-mail confirmation.
- [ ] Show that an off-domain e-mail is rejected.
- [ ] Upload, search, download, and delete a PDF in the deployed site.
- [ ] Add one team member to the Cognito `admins` group and demonstrate the dashboard.
- [ ] Capture screenshots of the CloudFormation stack, CloudFront distribution, Lambda functions, DynamoDB table, S3 buckets, Cognito pool, and CloudWatch dashboard.
- [ ] Save the stack outputs and approximate deployment cost.

## Final submission package

- [ ] Publish this source tree to GitHub or an equivalent hosted repository.
- [ ] Add the live URL, repository URL, team details, and deployment screenshots to the README.
- [ ] Prepare a final report of no more than five pages using `README.md`, `docs/ARCHITECTURE.md`, and `docs/SERVERLESS_VS_EC2.md` as source material.
- [ ] Prepare the final presentation and include the live URL or a short deployment fallback recording.
- [ ] Confirm every team member is from the same lab group and enter the lab group in the submission form if required.

## Demonstration order

1. State the problem: academic resources disappear into chats and personal drives.
2. Show the CloudFront-hosted app and Cognito sign-in.
3. Upload a PDF directly to S3 through a pre-signed URL, then confirm it becomes visible.
4. Search and download the file, then show the updated count.
5. Open the admin dashboard and CloudWatch monitoring.
6. Explain why Lambda, DynamoDB, S3, Cognito, API Gateway, and CloudFront make cloud computing integral to the solution.
