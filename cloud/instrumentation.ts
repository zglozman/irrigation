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

  // Hourly evaluation job: run at XX:00
  try {
    cron.schedule("0 * * * *", async () => {
      try {
        const subs = await listUserSubs();
        for (const sub of subs) {
          await reevaluateAllZones(sub);
        }
      } catch (error) {
        console.error("[Cron] Hourly reevaluation job error:", error);
      }
    }, { timezone: config.location.timezone });
    console.log("[Instrumentation] Registered hourly reevaluation job (0 * * * *)");
  } catch (error) {
    console.error("[Instrumentation] Failed to register reevaluation job:", error);
  }
}
