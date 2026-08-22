#!/usr/bin/env node

/**
 * Smoke test script for irrigation system
 *
 * Usage: AWS_PROFILE=beame node scripts/smoke.mjs
 *
 * This script performs live checks against real AWS resources and the IoT board:
 * - CloudFront /login returns 200
 * - Unauth /api/zones returns 401
 * - IoT retained irrigation-controller/status == "online"
 * - If board online: relay 16 ON→state==ON→OFF→state==OFF via iot-data
 * - DynamoDB table reachable
 *
 * Run from project root or cloud/ directory (for AWS SDK node_modules).
 * Exits non-zero on any FAIL (SKIP is not failure).
 */

import { execSync, spawn } from "child_process";
import {
  CloudFrontClient,
  GetDistributionCommand,
} from "@aws-sdk/client-cloudfront";
import {
  DynamoDBClient,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import {
  IoTDataPlaneClient,
  GetRetainedMessageCommand,
  PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";

const region = process.env.AWS_REGION || "us-east-1";
const profile = process.env.AWS_PROFILE || "default";

let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;

async function printResult(name, status, message = "") {
  const statusStr =
    status === "PASS"
      ? "\x1b[32mPASS\x1b[0m" // Green
      : status === "FAIL"
        ? "\x1b[31mFAIL\x1b[0m" // Red
        : status === "SKIP"
          ? "\x1b[33mSKIP\x1b[0m" // Yellow
          : status;

  console.log(`[${statusStr}] ${name}`);
  if (message) {
    console.log(`      ${message}`);
  }

  if (status === "PASS") testsPassed++;
  else if (status === "FAIL") testsFailed++;
  else if (status === "SKIP") testsSkipped++;
}

async function test1_CloudFront() {
  try {
    // Try to fetch CloudFront domain from stack outputs
    let distribution;
    try {
      const output = execSync(
        `aws cloudformation describe-stacks --stack-name irrigation --query 'Stacks[0].Outputs[?OutputKey==\`AppUrl\`].OutputValue' --output text --region ${region} --profile ${profile}`,
        { encoding: "utf-8", stdio: "pipe" }
      ).trim();

      if (!output || output.includes("ValidationError")) {
        await printResult(
          "CloudFront /login returns 200",
          "SKIP",
          "Stack not found or CloudFront not deployed"
        );
        return;
      }

      distribution = output;
    } catch {
      await printResult(
        "CloudFront /login returns 200",
        "SKIP",
        "Could not find CloudFront URL"
      );
      return;
    }

    const loginUrl = `${distribution}/login`;
    try {
      const response = await fetch(loginUrl, { method: "HEAD" });
      if (response.status === 200) {
        await printResult(
          "CloudFront /login returns 200",
          "PASS",
          distribution
        );
      } else {
        await printResult(
          "CloudFront /login returns 200",
          "FAIL",
          `Got ${response.status} instead`
        );
      }
    } catch (e) {
      await printResult(
        "CloudFront /login returns 200",
        "FAIL",
        e instanceof Error ? e.message : String(e)
      );
    }
  } catch (e) {
    await printResult(
      "CloudFront /login returns 200",
      "FAIL",
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function test2_UnauthorizedZones() {
  try {
    // Try to fetch CloudFront domain
    let distribution;
    try {
      const output = execSync(
        `aws cloudformation describe-stacks --stack-name irrigation --query 'Stacks[0].Outputs[?OutputKey==\`AppUrl\`].OutputValue' --output text --region ${region} --profile ${profile}`,
        { encoding: "utf-8", stdio: "pipe" }
      ).trim();

      if (!output || output.includes("ValidationError")) {
        await printResult(
          "Unauth /api/zones returns 401",
          "SKIP",
          "Stack not found"
        );
        return;
      }

      distribution = output;
    } catch {
      await printResult(
        "Unauth /api/zones returns 401",
        "SKIP",
        "Could not find CloudFront URL"
      );
      return;
    }

    const zonesUrl = `${distribution}/api/zones`;
    try {
      const response = await fetch(zonesUrl);
      if (response.status === 401) {
        await printResult("Unauth /api/zones returns 401", "PASS");
      } else {
        await printResult(
          "Unauth /api/zones returns 401",
          "FAIL",
          `Got ${response.status} instead`
        );
      }
    } catch (e) {
      await printResult(
        "Unauth /api/zones returns 401",
        "FAIL",
        e instanceof Error ? e.message : String(e)
      );
    }
  } catch (e) {
    await printResult(
      "Unauth /api/zones returns 401",
      "FAIL",
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function test3_IoTStatus() {
  try {
    const iotClient = new IoTClient({ region });
    const iotDataClient = new IoTDataPlaneClient({ region });

    // Get endpoint
    const endpoint = await iotClient.send(
      new DescribeEndpointCommand({ endpointType: "iot:Data-ATS" })
    );
    if (!endpoint.endpointAddress) {
      await printResult(
        "IoT retained irrigation-controller/status == online",
        "FAIL",
        "Could not get IoT endpoint"
      );
      return;
    }

    const dataClient = new IoTDataPlaneClient({
      region,
      endpoint: `https://${endpoint.endpointAddress}`,
    });

    try {
      const result = await dataClient.send(
        new GetRetainedMessageCommand({
          topic: "irrigation-controller/status",
        })
      );

      if (!result.payload) {
        await printResult(
          "IoT retained irrigation-controller/status == online",
          "FAIL",
          "No retained message found"
        );
        return;
      }

      const payloadStr = new TextDecoder().decode(result.payload).trim();
      if (payloadStr === "online") {
        await printResult(
          "IoT retained irrigation-controller/status == online",
          "PASS"
        );
      } else if (payloadStr === "offline") {
        await printResult(
          "IoT retained irrigation-controller/status == online",
          "SKIP",
          "Board is offline - skipping relay tests"
        );
      } else {
        await printResult(
          "IoT retained irrigation-controller/status == online",
          "FAIL",
          `Got: ${payloadStr}`
        );
      }
    } catch (e) {
      await printResult(
        "IoT retained irrigation-controller/status == online",
        "FAIL",
        e instanceof Error ? e.message : String(e)
      );
    }
  } catch (e) {
    await printResult(
      "IoT retained irrigation-controller/status == online",
      "FAIL",
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function test4_RelayControl() {
  try {
    const iotClient = new IoTClient({ region });

    // First check if board is online
    const endpoint = await iotClient.send(
      new DescribeEndpointCommand({ endpointType: "iot:Data-ATS" })
    );
    if (!endpoint.endpointAddress) {
      await printResult(
        "Relay 16 ON→state==ON→OFF→state==OFF",
        "SKIP",
        "Could not get IoT endpoint"
      );
      return;
    }

    const dataClient = new IoTDataPlaneClient({
      region,
      endpoint: `https://${endpoint.endpointAddress}`,
    });

    // Check board status first
    try {
      const statusResult = await dataClient.send(
        new GetRetainedMessageCommand({
          topic: "irrigation-controller/status",
        })
      );

      const statusStr = statusResult.payload
        ? new TextDecoder().decode(statusResult.payload).trim()
        : "offline";

      if (statusStr !== "online") {
        await printResult(
          "Relay 16 ON→state==ON→OFF→state==OFF",
          "SKIP",
          "Board is offline"
        );
        return;
      }
    } catch (e) {
      await printResult(
        "Relay 16 ON→state==ON→OFF→state==OFF",
        "SKIP",
        "Could not check board status"
      );
      return;
    }

    // Try relay control
    try {
      // Send ON command
      await dataClient.send(
        new PublishCommand({
          topic: "irrigation-controller/switch/relay_16/command",
          qos: 1,
          payload: "ON",
        })
      );

      // Wait a bit for device to process
      await new Promise((r) => setTimeout(r, 500));

      // Check state
      const stateResult = await dataClient.send(
        new GetRetainedMessageCommand({
          topic: "irrigation-controller/switch/relay_16/state",
        })
      );

      const state1 = stateResult.payload
        ? new TextDecoder().decode(stateResult.payload).trim()
        : "UNKNOWN";

      if (state1 !== "ON") {
        await printResult(
          "Relay 16 ON→state==ON→OFF→state==OFF",
          "FAIL",
          `After ON command, state is ${state1}, not ON`
        );
        return;
      }

      // Send OFF command
      await dataClient.send(
        new PublishCommand({
          topic: "irrigation-controller/switch/relay_16/command",
          qos: 1,
          payload: "OFF",
        })
      );

      // Wait for device
      await new Promise((r) => setTimeout(r, 500));

      // Check final state
      const stateResult2 = await dataClient.send(
        new GetRetainedMessageCommand({
          topic: "irrigation-controller/switch/relay_16/state",
        })
      );

      const state2 = stateResult2.payload
        ? new TextDecoder().decode(stateResult2.payload).trim()
        : "UNKNOWN";

      if (state2 === "OFF") {
        await printResult("Relay 16 ON→state==ON→OFF→state==OFF", "PASS");
      } else {
        await printResult(
          "Relay 16 ON→state==ON→OFF→state==OFF",
          "FAIL",
          `After OFF command, state is ${state2}, not OFF`
        );
      }
    } catch (e) {
      await printResult(
        "Relay 16 ON→state==ON→OFF→state==OFF",
        "FAIL",
        e instanceof Error ? e.message : String(e)
      );
    }
  } catch (e) {
    await printResult(
      "Relay 16 ON→state==ON→OFF→state==OFF",
      "FAIL",
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function test5_DynamoDB() {
  try {
    const dynamoClient = new DynamoDBClient({ region });

    try {
      // Try to scan with limit 1 to verify table access
      await dynamoClient.send(
        new ScanCommand({
          TableName: "IrrigationApp",
          Limit: 1,
        })
      );

      await printResult(
        "DynamoDB table reachable (describe via Scan)",
        "PASS"
      );
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes("ResourceNotFoundException")) {
        await printResult(
          "DynamoDB table reachable (describe via Scan)",
          "FAIL",
          "Table not found"
        );
      } else {
        await printResult(
          "DynamoDB table reachable (describe via Scan)",
          "FAIL",
          errorMsg
        );
      }
    }
  } catch (e) {
    await printResult(
      "DynamoDB table reachable (describe via Scan)",
      "FAIL",
      e instanceof Error ? e.message : String(e)
    );
  }
}

async function runAllTests() {
  console.log("Irrigation System Smoke Tests\n");

  await test1_CloudFront();
  await test2_UnauthorizedZones();
  await test3_IoTStatus();
  await test4_RelayControl();
  await test5_DynamoDB();

  console.log(`\n=== Results ===`);
  console.log(`PASS: ${testsPassed}`);
  console.log(`FAIL: ${testsFailed}`);
  console.log(`SKIP: ${testsSkipped}`);

  process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
