// Instrumentation hook for Next.js
// Sets up node-cron jobs for the scheduler and executor
// Only runs in Node.js runtime, not during build

import cron from "node-cron";
import { startupSafetyCheck, executeDueRuns } from "@/jobs/execute-runs";
import { reevaluateAllZones } from "@/jobs/reevaluate-schedule";
import { listUserSubs } from "@/lib/dynamo";
import { config } from "@/lib/config";

let registered = false;

export async function register() {
  // Only register in Node.js runtime and not during build
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Guard against double-registration
  if (registered) return;
  registered = true;

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
