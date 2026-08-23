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

export interface ForecastSnapshotLine {
  pulled_at: string;
  forecast_time: string;
  lead_hours: number;
  temp_f: number;
  wind_mph: number;
  precip_prob: number;
  precip_in: number;
  source: string;
}

/**
 * One JSONL line per forecast hour, so Athena can compare how the prediction
 * for a given hour evolved across pulls (lead_hours = how far out it was).
 */
export function buildForecastSnapshotLines(
  forecast: Array<{ time: string; tempF: number; windMph: number; precipProb: number; precipIn: number }>,
  pulledAt: Date,
  source = "tomorrow.io"
): ForecastSnapshotLine[] {
  return forecast.map((h) => ({
    pulled_at: pulledAt.toISOString(),
    forecast_time: h.time,
    lead_hours: Math.round(((new Date(h.time).getTime() - pulledAt.getTime()) / 3600000) * 10) / 10,
    temp_f: h.tempF,
    wind_mph: h.windMph,
    precip_prob: h.precipProb,
    precip_in: h.precipIn,
    source,
  }));
}

/**
 * Write an hourly forecast snapshot to S3 (partitioned by pull date, one
 * object per pull, one line per forecast hour).
 */
export async function writeForecastSnapshot(
  forecast: Array<{ time: string; tempF: number; windMph: number; precipProb: number; precipIn: number }>,
  pulledAt: Date = new Date()
): Promise<void> {
  const lines = buildForecastSnapshotLines(forecast, pulledAt);
  if (lines.length === 0) return;

  const year = pulledAt.getUTCFullYear();
  const month = String(pulledAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(pulledAt.getUTCDate()).padStart(2, "0");
  const s3Key = `forecast-snapshots/year=${year}/month=${month}/day=${day}/forecast-${uuidv4()}.jsonl`;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: config.aws.dataBucket,
      Key: s3Key,
      Body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      ContentType: "application/x-jsonlines",
    })
  );
}

export interface StationObservationLine {
  station_id: string;
  time_utc: string;
  time_local: string;
  temp_f: number | null;
  wind_mph: number | null;
  wind_high_mph: number | null;
  humidity: number | null;
  precip_accum_in: number;
  precip_hourly_in: number;
}

/**
 * Shape one local day of station observations into JSONL lines.
 * precip_hourly_in is derived from the running daily accumulation
 * (clamped at 0 in case the accumulator resets mid-day).
 */
export function buildStationDayLines(
  stationId: string,
  rows: Array<{
    time_utc: string;
    time_local: string;
    temp_f: number | null;
    wind_mph: number | null;
    wind_high_mph: number | null;
    precip_accum_in: number;
    humidity: number | null;
  }>
): StationObservationLine[] {
  let prevAccum = 0;
  return rows.map((r) => {
    const hourly = Math.max(0, (r.precip_accum_in ?? 0) - prevAccum);
    prevAccum = r.precip_accum_in ?? 0;
    return {
      station_id: stationId,
      time_utc: r.time_utc,
      time_local: r.time_local,
      temp_f: r.temp_f,
      wind_mph: r.wind_mph,
      wind_high_mph: r.wind_high_mph,
      humidity: r.humidity,
      precip_accum_in: r.precip_accum_in ?? 0,
      precip_hourly_in: Math.round(hourly * 1000) / 1000,
    };
  });
}

/**
 * Write one local day of station observations to S3. The key is
 * deterministic per station+day, so re-running a backfill or the nightly
 * job simply overwrites the same object — idempotent by construction.
 */
export async function writeStationDayObservations(
  stationId: string,
  dateLocal: string, // YYYY-MM-DD (station-local day)
  rows: Parameters<typeof buildStationDayLines>[1]
): Promise<void> {
  const lines = buildStationDayLines(stationId, rows);
  if (lines.length === 0) return;

  const [year, month, day] = dateLocal.split("-");
  const s3Key = `station-observations/year=${year}/month=${month}/day=${day}/hourly-${stationId}.jsonl`;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: config.aws.dataBucket,
      Key: s3Key,
      Body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      ContentType: "application/x-jsonlines",
    })
  );
}
