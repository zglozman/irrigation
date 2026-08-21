import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { IrrigationLogEntry } from "@/domain/irrigation-log";
import { config } from "./config";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: config.aws.region });
  }
  return s3Client;
}

/**
 * Write an irrigation log entry to S3
 * Partition by year/month/day/zone (relay channel in 2-digit format)
 * weather_snapshot is stringified JSON
 */
export async function writeIrrigationLog(entry: IrrigationLogEntry): Promise<void> {
  const client = getS3Client();
  const now = new Date(entry.timestamp);

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const relayChannel = String(entry.relay_channel).padStart(2, "0");

  const s3Key = `irrigation-events/year=${year}/month=${month}/day=${day}/zone=${relayChannel}/events-${uuidv4()}.jsonl`;

  // Stringify weather_snapshot to string
  const logEntry: any = {
    ...entry,
    weather_snapshot: JSON.stringify(entry.weather_snapshot),
  };

  const jsonlLine = JSON.stringify(logEntry) + "\n";

  await client.send(
    new PutObjectCommand({
      Bucket: config.aws.dataBucket,
      Key: s3Key,
      Body: jsonlLine,
      ContentType: "application/x-jsonlines",
    })
  );
}
