import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";
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
