// Settings page — server component: reads config server-side and passes only
// safe display fields to the client; @/lib/config must never reach the client bundle.

import { config } from "@/lib/config";
import InviteForm from "./invite-form";
import RainStationForm from "./rain-station-form";

// Config comes from the container's runtime env — never prerender at build time.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const display = {
    latitude: config.location.latitude.toFixed(4),
    longitude: config.location.longitude.toFixed(4),
    timezone: config.location.timezone,
    tempestConfigured: Boolean(config.weather.tempestStationId),
    supplyCapacityGph: config.system.supplyCapacityGph,
  };

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-8 md:px-12">
      <div className="flex items-baseline justify-between pb-3.5 pt-6 md:pt-8">
        <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink">
          settings
        </h1>
        <span className="font-mono text-[11px] text-fern">how the garden is wired</span>
      </div>

      <div className="flex flex-col gap-4">
        {/* Weather Config */}
        <div className="card flex flex-col gap-3.5 p-4">
          <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
            Weather &amp; location
          </h2>

          <div className="flex flex-col text-sm">
            <div className="flex justify-between py-2.5">
              <span className="text-fern">Latitude</span>
              <span className="font-mono text-ink">{display.latitude}</span>
            </div>
            <div className="flex justify-between border-t border-hairline py-2.5">
              <span className="text-fern">Longitude</span>
              <span className="font-mono text-ink">{display.longitude}</span>
            </div>
            <div className="flex justify-between border-t border-hairline py-2.5">
              <span className="text-fern">Timezone</span>
              <span className="font-mono text-ink">{display.timezone}</span>
            </div>
            <div className="flex justify-between border-t border-hairline py-2.5">
              <span className="text-fern">Weather provider</span>
              <span className="font-mono text-ink">Tomorrow.io</span>
            </div>
            <div className="flex justify-between border-t border-hairline py-2.5">
              <span className="text-fern">Tempest station</span>
              <span className="font-mono text-ink">
                {display.tempestConfigured ? "configured" : "not configured"}
              </span>
            </div>
            <div className="flex justify-between border-t border-hairline py-2.5">
              <span className="text-fern">Supply capacity</span>
              <span className="font-mono text-ink">{display.supplyCapacityGph} gph</span>
            </div>
          </div>

          <p className="border-t border-hairline pt-3 text-[11px] leading-normal text-fern">
            Configuration is set via environment variables. Contact your system administrator to
            change these settings.
          </p>
        </div>

        <RainStationForm />
        <InviteForm />
      </div>
    </div>
  );
}
