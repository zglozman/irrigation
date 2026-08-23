// Instrumentation hook for Next.js
// Sets up node-cron jobs for the scheduler and executor.
//
// IMPORTANT: no top-level imports of app code here. Next bundles this file
// for every runtime (including Edge, where node:crypto and the AWS SDK don't
// exist); everything must be dynamically imported inside the nodejs guard.

let registered = false;

export async function register() {
  // Only register in Node.js runtime and not during build
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Local dev safety: a second scheduler would race the ECS one against the
  // real board. Set DISABLE_SCHEDULER=1 in local runs.
  if (process.env.DISABLE_SCHEDULER === "1") {
    console.log("[Instrumentation] Scheduler disabled via DISABLE_SCHEDULER=1");
    return;
  }

  // Guard against double-registration
  if (registered) return;
  registered = true;

  const [{ default: cron }, { startupSafetyCheck, executeDueRuns }, { reevaluateAllZones }, { listUserSubs }, { config }] =
    await Promise.all([
      import("node-cron"),
      import("@/jobs/execute-runs"),
      import("@/jobs/reevaluate-schedule"),
      import("@/lib/dynamo").then((m) => ({ listUserSubs: m.listUserSubs })),
      import("@/lib/config"),
    ]);

  console.log("[Instrumentation] Setting up cron jobs");

  // Run startup safety check once at boot (all relays and all users)
  try {
    console.log("[Instrumentation] Running startup safety check");
    await startupSafetyCheck();
  } catch (error) {
    console.error("[Instrumentation] Startup safety check failed:", error);
  }

  // Minute-level execution job: run every minute
  try {
    cron.schedule("* * * * *", async () => {
      try {
        const subs = await listUserSubs();
        for (const sub of subs) {
          await executeDueRuns(sub);
        }
      } catch (error) {
        console.error("[Cron] Minute execution job error:", error);
      }
    }, { timezone: config.location.timezone });
    console.log("[Instrumentation] Registered minute-level execution job (* * * * *)");
  } catch (error) {
    console.error("[Instrumentation] Failed to register execution job:", error);
  }

  // Hourly evaluation job: run at XX:02 — the weather station reports on the
  // hour and half hour, so evaluating a couple of minutes after the hour reads
  // a fresh station observation instead of racing it.
  try {
    cron.schedule("2 * * * *", async () => {
      try {
        const subs = await listUserSubs();
        for (const sub of subs) {
          await reevaluateAllZones(sub);
        }
      } catch (error) {
        console.error("[Cron] Hourly reevaluation job error:", error);
      }
    }, { timezone: config.location.timezone });
    console.log("[Instrumentation] Registered hourly reevaluation job (2 * * * *)");
  } catch (error) {
    console.error("[Instrumentation] Failed to register reevaluation job:", error);
  }

  // Nightly station-history job: at 00:15 local, log yesterday's full day of
  // hourly station observations to S3/Athena. Idempotent (one object per day).
  try {
    cron.schedule("15 0 * * *", async () => {
      try {
        const [{ resolveWUCredentials }, { getWUHourlyHistory }, { writeStationDayObservations }] =
          await Promise.all([
            import("@/weather"),
            import("@/weather/wunderground"),
            import("@/lib/s3-logs"),
          ]);
        const creds = await resolveWUCredentials();
        if (!creds) return; // no station configured

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const dateLocal = new Intl.DateTimeFormat("en-CA", {
          timeZone: config.location.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(yesterday); // YYYY-MM-DD
        const rows = await getWUHourlyHistory(creds.stationId, creds.apiKey, dateLocal.replaceAll("-", ""));
        await writeStationDayObservations(creds.stationId, dateLocal, rows);
        console.log(`[Cron] Logged ${rows.length} station observations for ${dateLocal}`);
      } catch (error) {
        console.error("[Cron] Nightly station-history job error:", error);
      }
    }, { timezone: config.location.timezone });
    console.log("[Instrumentation] Registered nightly station-history job (15 0 * * *)");
  } catch (error) {
    console.error("[Instrumentation] Failed to register station-history job:", error);
  }
}
