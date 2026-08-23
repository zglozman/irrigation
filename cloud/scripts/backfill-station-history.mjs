#!/usr/bin/env node
// Backfill Weather Underground station history into S3 (station-observations/).
// One JSONL object per station-local day, one line per hour — same shape and
// keys as the app's nightly job, so re-runs and overlaps are harmless.
//
// Usage (from the cloud/ directory so node_modules and .env resolve):
//   node --env-file=.env ../scripts/backfill-station-history.mjs --since 2026-03-01 [--until 2026-08-22]

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const STATION = getArg("station", "KFLGAINE21");
const SINCE = getArg("since");
const UNTIL = getArg("until", new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10));
const BUCKET = process.env.DATA_BUCKET;
const REGION = process.env.AWS_REGION || "us-east-1";

if (!SINCE || !BUCKET) {
  console.error("Usage: node --env-file=.env ../scripts/backfill-station-history.mjs --since YYYY-MM-DD [--until YYYY-MM-DD]");
  console.error("Requires DATA_BUCKET in env.");
  process.exit(1);
}

const s3 = new S3Client({ region: REGION });

async function scrapeKey() {
  const res = await fetch(`https://www.wunderground.com/dashboard/pws/${STATION}`, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" },
  });
  if (!res.ok) throw new Error(`station page HTTP ${res.status}`);
  const html = await res.text();
  const keys = [...new Set([...html.matchAll(/apiKey[=":\\&;qu]{1,8}([0-9a-f]{32})/gi)].map((m) => m[1].toLowerCase()))];
  for (const key of keys) {
    const probe = await fetch(
      `https://api.weather.com/v2/pws/observations/current?stationId=${STATION}&format=json&units=e&apiKey=${key}`
    );
    if (probe.status === 200 || probe.status === 204) return key;
  }
  throw new Error("no working API key found in page");
}

function* days(since, until) {
  const d = new Date(`${since}T12:00:00Z`);
  const end = new Date(`${until}T12:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// Same line shape as cloud/lib/s3-logs.ts buildStationDayLines
function buildLines(rows) {
  let prevAccum = 0;
  return rows.map((obs) => {
    const imperial = obs.imperial || {};
    const accum = imperial.precipTotal ?? 0;
    const hourly = Math.max(0, accum - prevAccum);
    prevAccum = accum;
    return {
      station_id: STATION,
      time_utc: obs.obsTimeUtc,
      time_local: obs.obsTimeLocal,
      temp_f: imperial.tempAvg ?? null,
      wind_mph: imperial.windspeedAvg ?? null,
      wind_high_mph: imperial.windspeedHigh ?? null,
      humidity: obs.humidityAvg ?? null,
      precip_accum_in: accum,
      precip_hourly_in: Math.round(hourly * 1000) / 1000,
    };
  });
}

const key = await scrapeKey();
console.log(`station ${STATION} · key ...${key.slice(-4)} · ${SINCE} → ${UNTIL}`);

let written = 0, empty = 0, failed = 0, rainDays = 0, totalRain = 0;

for (const date of days(SINCE, UNTIL)) {
  const ymd = date.replaceAll("-", "");
  try {
    const res = await fetch(
      `https://api.weather.com/v2/pws/history/hourly?stationId=${STATION}&format=json&units=e&date=${ymd}&apiKey=${key}`
    );
    if (res.status === 204) { empty++; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = data.observations || [];
    if (rows.length === 0) { empty++; continue; }

    const lines = buildLines(rows);
    const dayRain = Math.max(...lines.map((l) => l.precip_accum_in));
    if (dayRain >= 0.01) { rainDays++; totalRain += dayRain; }

    const [y, m, d] = date.split("-");
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `station-observations/year=${y}/month=${m}/day=${d}/hourly-${STATION}.jsonl`,
      Body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      ContentType: "application/x-jsonlines",
    }));
    written++;
    if (written % 20 === 0) console.log(`  ${date}: ${written} days written so far…`);
  } catch (err) {
    failed++;
    console.error(`  ${date}: FAILED — ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 400)); // be polite
}

console.log(`done: ${written} days written, ${empty} empty, ${failed} failed`);
console.log(`rain: ${rainDays} rainy days, ${totalRain.toFixed(2)} in total across the window`);
