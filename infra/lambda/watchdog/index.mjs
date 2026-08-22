// Irrigation watchdog Lambda: monitor relays and force OFF if no active schedule
// ESM-based, uses AWS SDK v3 (built into nodejs20.x runtime)

import {
  DynamoDBClient,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import {
  IoTDataPlaneClient,
  GetRetainedMessageCommand,
  PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const TABLE_NAME = process.env.TABLE_NAME || "IrrigationApp";
const DATA_BUCKET = process.env.DATA_BUCKET || "irrigation-data";
const IOT_ENDPOINT = process.env.IOT_ENDPOINT || "a32q2fgemc15sw-ats.iot.us-east-1.amazonaws.com";
const TOPIC_PREFIX = process.env.TOPIC_PREFIX || "irrigation-controller";
const GRACE_MINUTES = parseInt(process.env.GRACE_MINUTES || "15", 10);

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const iotDataClient = new IoTDataPlaneClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: `https://${IOT_ENDPOINT}`,
});
const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

// Helper: get relay state from IoT Core retained message
async function getRelayState(channel) {
  try {
    const topic = `${TOPIC_PREFIX}/switch/relay_${channel}/state`;
    const result = await iotDataClient.send(
      new GetRetainedMessageCommand({ topic })
    );

    if (!result.payload) {
      return { state: "UNKNOWN", lastModified: null };
    }

    const payloadStr = new TextDecoder().decode(result.payload);
    return {
      state: payloadStr === "ON" ? "ON" : "OFF",
      lastModified: result.lastModifiedTime || null,
    };
  } catch (err) {
    if (err.name === "ResourceNotFoundException") {
      return { state: "UNKNOWN", lastModified: null };
    }
    console.error(`Error getting relay ${channel} state:`, err.message);
    return { state: "UNKNOWN", lastModified: null };
  }
}

// Fetch the relay channels covered by an ACTIVE, unexpired schedule — one
// paginated scan per invocation. Returns a Set of channel numbers, or null
// on failure. IMPORTANT: no Limit — DynamoDB's Limit caps items EXAMINED
// before the filter, which made an earlier version see "no schedules" and
// kill legitimate runs.
async function getActiveScheduleChannels() {
  const channels = new Set();
  const now = new Date().toISOString();
  let lastKey = undefined;
  try {
    do {
      const result = await dynamoClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          FilterExpression:
            "begins_with(SK, :sk) AND #status = :active AND scheduled_end > :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":sk": { S: "SCHED#" },
            ":active": { S: "ACTIVE" },
            ":now": { S: now },
          },
          ExclusiveStartKey: lastKey,
        })
      );
      for (const item of result.Items || []) {
        const ch = item.relay_channel && item.relay_channel.N;
        if (ch) channels.add(parseInt(ch, 10));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return channels;
  } catch (err) {
    // Fail SAFE for a watchdog: a DynamoDB error must never be read as
    // "no schedule" (that direction interrupts legitimate watering). The
    // firmware's 60-min cap still bounds a truly stuck valve until the
    // next tick.
    console.error("Error fetching active schedules; skipping this cycle:", err.message);
    return null;
  }
}

// Helper: write watchdog log to S3
async function writeWatchdogLog(channel, ageMin, reason) {
  try {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const relayStr = String(channel).padStart(2, "0");
    const uuid = randomUUID();

    const logEntry = {
      zone_id: "watchdog",
      relay_channel: channel,
      timestamp: now.toISOString(),
      trigger_type: "MANUAL",
      scheduled_runtime_min: 0,
      actual_runtime_min: 0,
      gallons_estimated_delivered: 0,
      weekly_target_gal: 0,
      remaining_before: 0,
      remaining_after: 0,
      rainfall_measured_in: 0,
      rainfall_gal_equiv: 0,
      weather_snapshot: "{}",
      outcome: "FAILED",
      reason: reason,
    };

    const jsonlLine = JSON.stringify(logEntry) + "\n";
    const s3Key = `irrigation-events/year=${year}/month=${month}/day=${day}/zone=${relayStr}/watchdog-${uuid}.jsonl`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: DATA_BUCKET,
        Key: s3Key,
        Body: jsonlLine,
        ContentType: "application/x-jsonlines",
      })
    );

    return true;
  } catch (err) {
    console.error(`Error writing watchdog log for relay ${channel}:`, err.message);
    return false;
  }
}

// Helper: force relay OFF
async function forceRelayOff(channel) {
  try {
    const topic = `${TOPIC_PREFIX}/switch/relay_${channel}/command`;
    await iotDataClient.send(
      new PublishCommand({
        topic,
        qos: 1,
        payload: "OFF",
      })
    );
    return true;
  } catch (err) {
    console.error(`Error forcing relay ${channel} OFF:`, err.message);
    return false;
  }
}

export async function handler(event) {
  console.log("[Watchdog] Starting check at", new Date().toISOString());

  const results = {
    checked: 0,
    forced: 0,
    logged: 0,
    errors: [],
  };

  // One schedule fetch per invocation; null means DynamoDB failed and we
  // must not force anything off this cycle.
  const activeChannels = await getActiveScheduleChannels();
  if (activeChannels === null) {
    console.warn("[Watchdog] Schedule lookup failed — no enforcement this cycle");
    return { statusCode: 200, body: JSON.stringify({ skipped: "dynamodb error" }) };
  }

  // Check each relay channel 1-16
  for (let channel = 1; channel <= 16; channel++) {
    try {
      results.checked++;

      const { state, lastModified } = await getRelayState(channel);

      if (state !== "ON") {
        continue; // Not on, no action needed
      }

      // Compute age in minutes
      let ageMin = 0;
      if (lastModified) {
        ageMin = Math.round((Date.now() - lastModified) / 60000);
      }

      const hasSchedule = activeChannels.has(channel);

      if (hasSchedule) {
        console.log(
          `[Watchdog] Relay ${channel} ON with active schedule (age: ${ageMin}m) — OK`
        );
        continue;
      }

      // No active schedule; check grace period
      if (ageMin <= GRACE_MINUTES) {
        console.log(
          `[Watchdog] Relay ${channel} ON (age: ${ageMin}m) within grace period — OK`
        );
        continue;
      }

      // Force OFF
      const reason = `Watchdog: relay ${channel} ON for ${ageMin} min with no active schedule; forced OFF`;
      console.log(`[Watchdog] ${reason}`);

      const offOk = await forceRelayOff(channel);
      if (offOk) {
        results.forced++;
        const logOk = await writeWatchdogLog(channel, ageMin, reason);
        if (logOk) {
          results.logged++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Watchdog] Error checking channel ${channel}:`, msg);
      results.errors.push({ channel, error: msg });
    }
  }

  console.log("[Watchdog] Complete:", results);
  return {
    statusCode: 200,
    body: JSON.stringify(results),
  };
}
