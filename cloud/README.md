# Irrigation Control System

Smart watering control cloud application for automated landscape irrigation scheduling and management.

## What This App Is

A Next.js-based cloud control system for irrigation systems that:
- Schedules automatic watering based on weather forecasts and water budget targets
- Manages multiple irrigation zones with per-zone configuration (plant type, irrigation method, water needs)
- Enforces safety constraints (freeze gates, wind gates, rain skip)
- Tracks water delivery and budget consumption
- Provides user authentication via AWS Cognito
- Commands IoT relays via AWS IoT Core

## Environment Setup

Copy `.env.example` to `.env` and fill in required values:

```bash
cp .env.example .env
```

Required environment variables:
- AWS region, credentials, and resource names (DynamoDB table, S3 bucket, Athena config)
- Cognito user pool and client credentials
- Weather API key (Tomorrow.io)
- Location (latitude, longitude, timezone)
- Optional: WeatherFlow Tempest device ID and token for measured rainfall
- Optional: Bedrock CHAT_MODEL for the AI assistant (see below)

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in.

## AI Chat Assistant (Bedrock + Claude)

The app includes an AI chat assistant powered by AWS Bedrock and Claude, providing natural-language zone management and scheduling queries.

### Setup

1. Enable Anthropic Claude model access in the [AWS Bedrock console](https://console.aws.amazon.com/bedrock/) for your region:
   - Navigate to **Model access** → search for "Claude"
   - Request access to at least one Claude model (Opus 5 Sonnet recommended)
   - Wait for approval (usually immediate)

2. Ensure your AWS credentials have Bedrock permissions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "bedrock:InvokeModel",
           "bedrock:InvokeModelWithResponseStream"
         ],
         "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
       }
     ]
   }
   ```

3. Set `CHAT_MODEL` in `.env` (default: `us.anthropic.claude-opus-5`)

The chat widget appears as a floating button in the bottom-right corner of the dashboard.

## Docker Deployment

```bash
docker-compose up -d
```

The app will be available at http://localhost:3000. Ensure `.env` is configured before starting.
