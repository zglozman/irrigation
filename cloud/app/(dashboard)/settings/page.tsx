// Settings page — server component: reads config server-side and passes only
// safe display fields to the client; @/lib/config must never reach the client bundle.

import { config } from "@/lib/config";
import InviteForm from "./invite-form";

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
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-slate-400">System configuration and user management</p>
      </div>

      <div className="max-w-2xl space-y-8">
        {/* Weather Config */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">Weather &amp; Location</h2>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Latitude</span>
              <span className="text-white font-mono">{display.latitude}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-3">
              <span className="text-slate-400">Longitude</span>
              <span className="text-white font-mono">{display.longitude}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-3">
              <span className="text-slate-400">Timezone</span>
              <span className="text-white font-mono">{display.timezone}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-3">
              <span className="text-slate-400">Weather Provider</span>
              <span className="text-white font-mono">Tomorrow.io</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-3">
              <span className="text-slate-400">Tempest Station</span>
              <span className="text-white font-mono">
                {display.tempestConfigured ? "Configured" : "Not configured"}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-3">
              <span className="text-slate-400">Supply Capacity</span>
              <span className="text-white font-mono">{display.supplyCapacityGph} GPH</span>
            </div>
          </div>

          <p className="text-xs text-slate-500 pt-3 border-t border-slate-800">
            Configuration is set via environment variables. Contact your system administrator to
            change these settings.
          </p>
        </div>

        <InviteForm />
      </div>
    </div>
  );
}
