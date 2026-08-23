import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { config } from "./config";

let dynamoClient: DynamoDBDocumentClient | null = null;

function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    const clientConfig: DynamoDBClientConfig = {
      region: config.aws.region,
    };
    const baseClient = new DynamoDBClient(clientConfig);
    dynamoClient = DynamoDBDocumentClient.from(baseClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return dynamoClient;
}

// Types for single-table design
export interface ZoneItem {
  PK: string; // USER#<sub>
  SK: string; // ZONE#<id>
  zone_id: string;
  relay_channel: number;
  name: string;
  area_sqft: number;
  location?: string;
}

export interface PlantConfigItem {
  PK: string; // USER#<sub>
  SK: string; // PLANT#<id>
  zone_id: string;
  zone_type: string; // cool-season-turf, warm-season-turf, vegetable, shrub, xeric, trees
  irrigation_method: string; // drip, spray, soaker
  // For drip
  emitter_count?: number;
  emitter_gph?: number;
  // For spray
  head_count?: number;
  head_gpm?: number;
  // For soaker
  soaker_length_ft?: number;
  soaker_gph_per_ft?: number;
  // For per-plant (trees, shrubs)
  plant_quantity?: number;
  gal_per_week_per_plant?: number;
  // Computed
  total_gal_per_week?: number;
  gal_week_source?: string; // "lookup table" or "custom"
}

export interface BudgetItem {
  PK: string; // USER#<sub>
  SK: string; // BUDGET#<id>
  zone_id: string;
  weekly_target_gal: number;
  delivered_gal_this_week: number;
  rainfall_gal_this_week: number;
  week_start_date: string; // ISO date
  last_updated: string; // ISO timestamp
}

export interface ScheduleItem {
  PK: string; // USER#<sub>
  SK: string; // SCHED#<id>
  zone_id: string;
  relay_channel: number;
  scheduled_start: string; // ISO timestamp when to turn ON
  scheduled_runtime_min: number;
  scheduled_end: string; // ISO timestamp when to turn OFF
  trigger_reason: string; // "scheduled", "manual", etc.
  status: "PENDING" | "ACTIVE" | "COMPLETED"; // Run status
  actual_start?: string; // ISO timestamp when actually turned ON
  actual_end?: string; // ISO timestamp when actually turned OFF
  outcome?: "RAN" | "FAILED"; // Outcome if completed
  failure_reason?: string; // Reason for failure if outcome is FAILED
}

export interface DeviceItem {
  PK: string; // USER#<sub>
  SK: string; // DEVICE
  thing_name: string;
  cert_id?: string;
  last_heartbeat?: string; // ISO timestamp
}

export interface WeatherSettingsItem {
  PK: string; // APP
  SK: string; // SETTINGS#WEATHER
  wu_station_id?: string;
  wu_api_key?: string;
  updated_at: string; // ISO timestamp
}

// Zone operations
export async function getZones(sub: string): Promise<ZoneItem[]> {
  const client = getDynamoClient();
  const result = await client.send(
    new QueryCommand({
      TableName: config.aws.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `USER#${sub}`,
        ":sk": "ZONE#",
      },
    })
  );
  // Filter to only base ZONE# items, not sub-items (which use PLANT#, BUDGET#, SCHED# prefixes)
  const items = result.Items || [];
  return items.filter(item => {
    const sk = (item as any).SK as string;
    // Only return items that are exactly ZONE#<id>, not ZONE#<id>#PLANT etc.
    return sk.match(/^ZONE#[^#]+$/) !== null;
  }) as ZoneItem[];
}

export async function getZone(sub: string, zoneId: string): Promise<ZoneItem | null> {
  const client = getDynamoClient();
  const result = await client.send(
    new GetCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: `ZONE#${zoneId}`,
      },
    })
  );
  return (result.Item as ZoneItem) || null;
}

export async function putZone(sub: string, zone: Omit<ZoneItem, "PK" | "SK">): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new PutCommand({
      TableName: config.aws.tableName,
      Item: {
        PK: `USER#${sub}`,
        SK: `ZONE#${zone.zone_id}`,
        ...zone,
      },
    })
  );
}

export async function deleteZone(sub: string, zoneId: string): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new DeleteCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: `ZONE#${zoneId}`,
      },
    })
  );
  // Also delete plant config
  await client.send(
    new DeleteCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: `PLANT#${zoneId}`,
      },
    })
  );
  // Also delete budget
  await client.send(
    new DeleteCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: `BUDGET#${zoneId}`,
      },
    })
  );
  // Also delete schedule (fix 17)
  await client.send(
    new DeleteCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: `SCHED#${zoneId}`,
      },
    })
  );
}

// Plant configuration operations
export async function putPlantConfig(sub: string, config_item: Omit<PlantConfigItem, "PK" | "SK">): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new PutCommand({
      TableName: config.aws.tableName,
      Item: {
        PK: `USER#${sub}`,
        SK: `PLANT#${config_item.zone_id}`,
        ...config_item,
      },
    })
  );
}

export async function getPlantConfig(sub: string, zoneId: string): Promise<PlantConfigItem | null> {
  const client = getDynamoClient();
  const result = await client.send(
    new GetCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: `PLANT#${zoneId}`,
      },
    })
  );
  return (result.Item as PlantConfigItem) || null;
}

// Budget operations
export async function getBudget(sub: string, zoneId: string): Promise<BudgetItem | null> {
  const client = getDynamoClient();
  const result = await client.send(
    new GetCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: `BUDGET#${zoneId}`,
      },
    })
  );
  return (result.Item as BudgetItem) || null;
}

export async function putBudget(sub: string, budget: Omit<BudgetItem, "PK" | "SK">): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new PutCommand({
      TableName: config.aws.tableName,
      Item: {
        PK: `USER#${sub}`,
        SK: `BUDGET#${budget.zone_id}`,
        ...budget,
      },
    })
  );
}

// Schedule operations
export async function putSchedule(sub: string, schedule: Omit<ScheduleItem, "PK" | "SK">): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new PutCommand({
      TableName: config.aws.tableName,
      Item: {
        PK: `USER#${sub}`,
        SK: `SCHED#${schedule.zone_id}`,
        ...schedule,
      },
    })
  );
}

// Write a schedule unless the zone's current schedule is ACTIVE — guards the
// scheduler against clobbering a run the executor just started. Returns false
// if the write was rejected.
export async function putScheduleIfNotActive(
  sub: string,
  schedule: Omit<ScheduleItem, "PK" | "SK">
): Promise<boolean> {
  const client = getDynamoClient();
  try {
    await client.send(
      new PutCommand({
        TableName: config.aws.tableName,
        Item: {
          PK: `USER#${sub}`,
          SK: `SCHED#${schedule.zone_id}`,
          ...schedule,
        },
        ConditionExpression: "attribute_not_exists(PK) OR #status <> :active",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":active": "ACTIVE" },
      })
    );
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}

// Atomically transition a schedule's status. Returns false if the item was
// not in `expectedStatus` (another tick or a reevaluation won the race) —
// callers must skip their side effects (publish/credit/log) in that case.
export async function transitionScheduleStatus(
  sub: string,
  zoneId: string,
  expectedStatus: string,
  newStatus: string,
  extraFields: Record<string, unknown> = {}
): Promise<boolean> {
  const client = getDynamoClient();
  const setParts = ["#status = :new"];
  const names: Record<string, string> = { "#status": "status" };
  const values: Record<string, unknown> = { ":new": newStatus, ":expected": expectedStatus };
  for (const [k, v] of Object.entries(extraFields)) {
    names[`#f_${k}`] = k;
    values[`:f_${k}`] = v;
    setParts.push(`#f_${k} = :f_${k}`);
  }
  try {
    await client.send(
      new UpdateCommand({
        TableName: config.aws.tableName,
        Key: { PK: `USER#${sub}`, SK: `SCHED#${zoneId}` },
        UpdateExpression: `SET ${setParts.join(", ")}`,
        ConditionExpression: "#status = :expected",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}

export async function getSchedule(sub: string, zoneId: string): Promise<ScheduleItem | null> {
  const client = getDynamoClient();
  const result = await client.send(
    new GetCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: `SCHED#${zoneId}`,
      },
    })
  );
  return (result.Item as ScheduleItem) || null;
}

export async function getSchedules(sub: string): Promise<ScheduleItem[]> {
  const client = getDynamoClient();
  const result = await client.send(
    new QueryCommand({
      TableName: config.aws.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk_prefix)",
      ExpressionAttributeValues: {
        ":pk": `USER#${sub}`,
        ":sk_prefix": "SCHED#",
      },
    })
  );
  return (result.Items || []) as ScheduleItem[];
}

// Device operations
export async function getDevice(sub: string): Promise<DeviceItem | null> {
  const client = getDynamoClient();
  const result = await client.send(
    new GetCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: `USER#${sub}`,
        SK: "DEVICE",
      },
    })
  );
  return (result.Item as DeviceItem) || null;
}

export async function putDevice(sub: string, device: Omit<DeviceItem, "PK" | "SK">): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new PutCommand({
      TableName: config.aws.tableName,
      Item: {
        PK: `USER#${sub}`,
        SK: "DEVICE",
        ...device,
      },
    })
  );
}

// User enumeration for global jobs
// Scans for all items with PK starting with USER# and projects to distinct subs
export async function listUserSubs(): Promise<string[]> {
  const client = getDynamoClient();
  const subs = new Set<string>();
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const result = await client.send(
      new ScanCommand({
        TableName: config.aws.tableName,
        FilterExpression: "begins_with(PK, :pk_prefix)",
        ExpressionAttributeValues: {
          ":pk_prefix": "USER#",
        },
        ProjectionExpression: "PK",
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    // Extract unique user subs from PKs
    for (const item of result.Items || []) {
      const pk = (item as any).PK as string;
      const sub = pk.replace(/^USER#/, "");
      if (sub) subs.add(sub);
    }

    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return Array.from(subs);
}

// Weather settings operations (app-global single item)
export async function getWeatherSettings(): Promise<WeatherSettingsItem | null> {
  const client = getDynamoClient();
  const result = await client.send(
    new GetCommand({
      TableName: config.aws.tableName,
      Key: {
        PK: "APP",
        SK: "SETTINGS#WEATHER",
      },
    })
  );
  return (result.Item as WeatherSettingsItem) || null;
}

export async function putWeatherSettings(settings: {
  wu_station_id?: string;
  wu_api_key?: string;
}): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new PutCommand({
      TableName: config.aws.tableName,
      Item: {
        PK: "APP",
        SK: "SETTINGS#WEATHER",
        wu_station_id: settings.wu_station_id,
        wu_api_key: settings.wu_api_key,
        updated_at: new Date().toISOString(),
      },
    })
  );
}
