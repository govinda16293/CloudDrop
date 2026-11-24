#!/usr/bin/env bash
# Deploy CloudDrop to your own AWS account: backend stack first, then the site.
#
#   ./scripts/deploy.sh
#
# Optional settings (environment variables):
#   STACK_NAME    default clouddrop    lower case letters, digits, hyphens
#   AWS_REGION    default ap-south-1
#   EMAIL_DOMAIN  default thapar.edu   only this e-mail domain can sign up
#   MAX_FILE_MB   default 25
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_NAME="${STACK_NAME:-clouddrop}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
EMAIL_DOMAIN="${EMAIL_DOMAIN:-thapar.edu}"
MAX_FILE_MB="${MAX_FILE_MB:-25}"

die() { echo "error: $*" >&2; exit 1; }

for tool in aws sam npm; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is not installed. See docs/DEPLOYMENT.md."
done
[[ "$STACK_NAME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] \
  || die "STACK_NAME must be lower case letters, digits and hyphens (it becomes part of an S3 bucket name)."
aws sts get-caller-identity >/dev/null 2>&1 \
  || die "AWS credentials are not set up. Run 'aws configure' first."

echo "==> Building the Lambda package"
sam build --template-file infra/template.yaml

echo "==> Deploying stack '$STACK_NAME' to $AWS_REGION (first run takes about 10 minutes: CloudFront is slow to create)"
sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "AllowedEmailDomain=$EMAIL_DOMAIN" "MaxFileSizeMb=$MAX_FILE_MB" \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset

output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
SITE_URL="$(output SiteUrl)"
SITE_BUCKET="$(output SiteBucketName)"
DISTRIBUTION_ID="$(output DistributionId)"
USER_POOL_ID="$(output UserPoolId)"
USER_POOL_CLIENT_ID="$(output UserPoolClientId)"
[ -n "$SITE_BUCKET" ] && [ -n "$USER_POOL_ID" ] || die "Could not read the stack outputs."

echo "==> Building the site"
npm --prefix frontend ci
npm --prefix frontend run build

# The site reads its settings at run time, so the same build works anywhere.
cat > frontend/dist/config.json <<JSON
{
  "authMode": "cognito",
  "apiBase": "/api",
  "emailDomain": "$EMAIL_DOMAIN",
  "userPoolId": "$USER_POOL_ID",
  "userPoolClientId": "$USER_POOL_CLIENT_ID"
}
JSON

echo "==> Uploading the site"
aws s3 sync frontend/dist "s3://$SITE_BUCKET" --delete --region "$AWS_REGION"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" >/dev/null

cat <<DONE

CloudDrop is live:  $SITE_URL
CloudWatch board:   $(output DashboardUrl)

Next: sign up on the site with an @$EMAIL_DOMAIN address, then make yourself an admin:

  aws cognito-idp admin-add-user-to-group --region $AWS_REGION \\
    --user-pool-id $USER_POOL_ID --group-name admins --username YOUR_EMAIL

Sign out and in again for the admin role to take effect.
DONE
