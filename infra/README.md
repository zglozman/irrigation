# Irrigation Infrastructure (AWS CDK)

This is an AWS CDK (TypeScript) application that provisions the complete cloud infrastructure for the personal irrigation-control system.

## Prerequisites

- Node.js 18+ and npm installed
- AWS CLI v2 configured with credentials (`aws configure`)
- An AWS account (uses only free-tier eligible services with pay-per-request billing)

## Quick Start

### 1. Install dependencies and build

```bash
cd infra
npm install
npm run build
```

### 2. Bootstrap the CDK (first time only)

This creates an S3 bucket and IAM roles needed by CDK:

```bash
npx cdk bootstrap
```

### 3. Deploy the stack

```bash
npx cdk deploy
```

Confirm the deployment when prompted. This creates:
- Cognito User Pool (invite-only)
- DynamoDB table (`IrrigationApp`)
- Data S3 bucket (private, for JSONL logs)
- Firmware S3 bucket (public read access for OTA)
- Glue database and table (with partition projection)
- IoT Core Thing and Policy
- IAM user (`irrigation-app`) with scoped permissions

## Post-Deployment Manual Steps

After `cdk deploy` completes, run these commands to finish setup:

### 1. Create IAM access key for the app

```bash
aws iam create-access-key --user-name irrigation-app
```

Save the `AccessKeyId` and `SecretAccessKey` to inject into the app container as environment variables:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

### 2. Create and attach IoT Core certificate

For the **device** (E16P board):

```bash
# Generate a new certificate and keys
aws iot create-keys-and-certificate --set-as-active \
  --certificate-pem-outfile cert.pem \
  --private-key-outfile private.key \
  --public-key-outfile public.key

# Note the CertificateArn from the output, then attach the policy:
aws iot attach-policy --policy-name irrigation-controller-policy \
  --target <CertificateArn>

# Attach to the Thing
aws iot attach-thing-principal --thing-name irrigation-controller \
  --principal <CertificateArn>

# Copy cert.pem, private.key, and the AmazonRootCA1 to firmware/secrets.yaml
```

### 3. Fetch the IoT Core data endpoint

```bash
aws iot describe-endpoint --endpoint-type iot:Data-ATS
```

Use this endpoint in `firmware/kc868-e16p.yaml` for the MQTT `broker:` setting.

### 4. Create the first user (yourself)

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username <your-email> \
  --user-attributes Name=email,Value=<your-email> Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

The user will receive a temporary password via email. Log into the web app with that password to set a permanent one (the app will prompt for a new password on first login).

The `UserPoolId` is available from the CDK stack outputs.

### 5. Fetch the app client secret (for environment configuration)

```bash
aws cognito-idp describe-user-pool-client \
  --user-pool-id <UserPoolId> \
  --client-id <AppClientId> \
  --query 'UserPoolClient.ClientSecret' \
  --output text
```

The `AppClientId` is also available from the CDK stack outputs. Add this secret to the app's `.env` file.

## Stack Outputs

After deployment, retrieve outputs with:

```bash
aws cloudformation describe-stacks --stack-name IrrigationStack \
  --query 'Stacks[0].Outputs[]' --output table
```

Key outputs:
- `UserPoolId` — Cognito User Pool ID
- `AppClientId` — Cognito App Client ID
- `TableName` — DynamoDB table name
- `DataBucketName` — S3 bucket for JSONL logs
- `FirmwareBucketName` — S3 bucket for firmware artifacts
- `IoTThingName` — IoT Core Thing name
- `IAMUserName` — IAM user for the app

## Destroying the Stack

```bash
npx cdk destroy
```

Note: `RemovalPolicy.RETAIN` is set on DynamoDB and S3 buckets to prevent accidental data loss.

## Development

- Stack definition: `lib/irrigation-stack.ts`
- Entry point: `bin/infra.ts`
- Config: `cdk.json`

To synthesize the CloudFormation template without deploying:

```bash
npx cdk synth
```

This outputs JSON to `cdk.out/IrrigationStack.template.json`.
