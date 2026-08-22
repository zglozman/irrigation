import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";
import { IoTDataPlaneClient, PublishCommand, GetRetainedMessageCommand } from "@aws-sdk/client-iot-data-plane";
import { config } from "./config";

let iotClient: IoTClient | null = null;
let iotDataClient: IoTDataPlaneClient | null = null;
let iotDataEndpoint: string | undefined = undefined;

function getIoTClient(): IoTClient {
  if (!iotClient) {
    iotClient = new IoTClient({ region: config.aws.region });
  }
  return iotClient;
}

async function getIoTDataEndpoint(): Promise<string> {
  if (iotDataEndpoint) return iotDataEndpoint;

  const client = getIoTClient();
  const result = await client.send(
    new DescribeEndpointCommand({
      endpointType: "iot:Data-ATS",
    })
  );

  iotDataEndpoint = result.endpointAddress;
  if (!iotDataEndpoint) throw new Error("Failed to get IoT data endpoint");

  return iotDataEndpoint;
}

async function getIoTDataClient(): Promise<IoTDataPlaneClient> {
  if (!iotDataClient) {
    // Initialize with resolved endpoint
    const endpoint = await getIoTDataEndpoint();
    iotDataClient = new IoTDataPlaneClient({
      region: config.aws.region,
      endpoint: `https://${endpoint}`,
    });
  }
  return iotDataClient;
}

export async function commandRelay(zoneChannel: number, on: boolean): Promise<void> {
  const client = await getIoTDataClient();

  const topic = `${config.iot.topicPrefix}/switch/relay_${zoneChannel}/command`;
  const payload = on ? "ON" : "OFF";

  await client.send(
    new PublishCommand({
      topic,
      qos: 1,
      payload: payload,
    })
  );
}

/**
 * Get the state of a single relay from retained message
 * @param channel - Relay channel (1-16)
 * @returns "ON", "OFF", or "UNKNOWN" if not found
 */
export async function getRelayState(channel: number): Promise<"ON" | "OFF" | "UNKNOWN"> {
  try {
    const client = await getIoTDataClient();
    const topic = `${config.iot.topicPrefix}/switch/relay_${channel}/state`;

    const result = await client.send(
      new GetRetainedMessageCommand({
        topic,
      })
    );

    if (!result.payload) {
      return "UNKNOWN";
    }

    // Payload is Uint8Array, decode to string
    const payloadStr = new TextDecoder().decode(result.payload);
    if (payloadStr === "ON") return "ON";
    if (payloadStr === "OFF") return "OFF";
    return "UNKNOWN";
  } catch (error: any) {
    // ResourceNotFoundException means no retained message
    if (error.name === "ResourceNotFoundException") {
      return "UNKNOWN";
    }
    console.error(`Error getting relay ${channel} state:`, error);
    return "UNKNOWN";
  }
}

/**
 * Get the state of all 16 relays in parallel
 * @returns Record of channel -> state
 */
export async function getAllRelayStates(): Promise<Record<number, string>> {
  const states: Record<number, string> = {};

  const promises = Array.from({ length: 16 }, (_, i) =>
    getRelayState(i + 1).then((state) => {
      states[i + 1] = state;
    })
  );

  await Promise.all(promises);
  return states;
}

/**
 * Publish a raw message to a topic
 * @param topic - MQTT topic
 * @param payload - String payload
 */
export async function publishRaw(topic: string, payload: string): Promise<void> {
  const client = await getIoTDataClient();

  await client.send(
    new PublishCommand({
      topic,
      qos: 1,
      payload: payload,
    })
  );
}

/**
 * Get retained message as JSON
 * @param topic - MQTT topic
 * @returns Parsed JSON or null if not found/invalid
 */
export async function getRetainedJson(topic: string): Promise<any | null> {
  try {
    const client = await getIoTDataClient();

    const result = await client.send(
      new GetRetainedMessageCommand({
        topic,
      })
    );

    if (!result.payload) {
      return null;
    }

    const payloadStr = new TextDecoder().decode(result.payload);
    try {
      return JSON.parse(payloadStr);
    } catch {
      return null;
    }
  } catch (error: any) {
    // ResourceNotFoundException means no retained message
    if (error.name === "ResourceNotFoundException") {
      return null;
    }
    console.error(`Error getting retained message from ${topic}:`, error);
    return null;
  }
}

/**
 * Get board online/offline status with timestamp
 * @returns { state: "online"|"offline"|"unknown", since: ISO timestamp or null }
 */
export async function getBoardStatus(): Promise<{
  state: "online" | "offline" | "unknown";
  since: string | null;
}> {
  try {
    const client = await getIoTDataClient();

    const result = await client.send(
      new GetRetainedMessageCommand({
        topic: `${config.iot.topicPrefix}/status`,
      })
    );

    // Default to unknown with no timestamp
    let state: "online" | "offline" | "unknown" = "unknown";
    let since: string | null = null;

    if (result.payload) {
      // ESPHome's birth/last-will payload is the plain string "online"/"offline".
      const payloadStr = new TextDecoder().decode(result.payload).trim();
      if (payloadStr === "online" || payloadStr === "offline") {
        state = payloadStr;
      }
    }

    // Convert lastModifiedTime (epoch ms) to ISO timestamp
    if (result.lastModifiedTime) {
      since = new Date(result.lastModifiedTime).toISOString();
    }

    return { state, since };
  } catch {
    return { state: "unknown", since: null };
  }
}
