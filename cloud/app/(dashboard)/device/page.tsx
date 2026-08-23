// The box — board status and backup WiFi setup

"use client";

import { useEffect, useState } from "react";

interface WiFiNetwork {
  ssid: string;
  rssi: number;
  secured: boolean;
}

interface WiFiStatus {
  active?: "wifi" | "ethernet";
  ssid?: string;
  ip?: string;
  configured?: string;
  ts?: number;
}

interface BoardInfo {
  state: "online" | "offline" | "unknown";
  since: string | null;
}

interface FirmwareInfo {
  version?: string;
  [key: string]: any;
}

function BoardIcon({ awake }: { awake: boolean }) {
  return (
    <svg
      width="72"
      height="48"
      viewBox="0 0 96 64"
      fill="none"
      stroke="#2f8f4e"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="92" height="56" rx="5" />
      <rect x="10" y="14" width="10" height="14" rx="1.5" />
      <rect x="24" y="14" width="10" height="14" rx="1.5" />
      <rect x="38" y="14" width="10" height="14" rx="1.5" />
      <rect x="52" y="14" width="10" height="14" rx="1.5" />
      <rect x="66" y="14" width="10" height="14" rx="1.5" />
      <rect x="10" y="38" width="24" height="14" rx="2" />
      <circle cx="84" cy="46" r="3.5" fill={awake ? "#57b46f" : "#d26743"} stroke="none" />
    </svg>
  );
}

function WifiIcon({ strong, active }: { strong: boolean; active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "#2f8f4e" : "#79907e"}
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12.5a10 10 0 0 1 14 0" />
      <path d="M8.5 16a5 5 0 0 1 7 0" />
      <path d="M12 19.5h.01" />
      {strong && <path d="M2 9a15 15 0 0 1 20 0" />}
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#79907e"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// strength words instead of dBm
function strengthWord(rssi: number): "strong" | "good" | "weak" {
  if (rssi >= -60) return "strong";
  if (rssi >= -70) return "good";
  return "weak";
}

function formatRelativeTime(isoString: string | null): { relative: string; absolute: string } {
  if (!isoString) {
    return { relative: "never", absolute: "" };
  }

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative = "";

  if (diffSecs < 60) {
    relative = "just now";
  } else if (diffMins < 60) {
    relative = `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  } else if (diffHours < 24) {
    relative = `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else if (diffDays === 1) {
    relative = `yesterday ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
  } else if (diffDays < 7) {
    relative = `${diffDays} days ago`;
  } else {
    relative = date.toLocaleDateString();
  }

  const absolute = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return { relative, absolute };
}

export default function DevicePage() {
  const [boardStatus, setBoardStatus] = useState<BoardInfo>({ state: "unknown", since: null });
  const [wifiStatus, setWifiStatus] = useState<WiFiStatus | null>(null);
  const [firmwareInfo, setFirmwareInfo] = useState<FirmwareInfo | null>(null);
  const [networks, setNetworks] = useState<WiFiNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setError] = useState("");
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const [configError, setConfigError] = useState("");

  // Load device status and poll every 10s
  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const response = await fetch("/api/device/status");
      if (!response.ok) throw new Error("Failed to load device status");
      const data = await response.json();
      setBoardStatus(data.board);
      setWifiStatus(data.wifi);
      setFirmwareInfo(data.firmware);
    } catch (err) {
      console.error("[Device] Status error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    setError("");
    setNetworks([]);

    try {
      // Request scan
      const scanResponse = await fetch("/api/device/wifi/scan", { method: "POST" });
      if (!scanResponse.ok) throw new Error("Failed to trigger scan");

      // Poll for results
      let attempts = 0;
      const maxAttempts = 20; // 20 x 2s = 40 seconds max

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000)); // Wait 2s between polls

        const networkResponse = await fetch("/api/device/wifi/networks");
        if (networkResponse.ok) {
          const data = await networkResponse.json();
          if (data.networks && data.networks.length > 0) {
            setNetworks(data.networks);
            break;
          }
        }

        attempts++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setError(message);
      console.error("[Device] Scan error:", err);
    } finally {
      setScanning(false);
    }
  };

  const handleConnect = async (network: WiFiNetwork) => {
    if (!password) {
      setConfigError("Password required");
      return;
    }

    setConfiguring(true);
    setConfigError("");
    setConfigMessage("");

    try {
      const response = await fetch("/api/device/wifi/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ssid: network.ssid,
          password,
        }),
      });

      if (!response.ok) throw new Error("Failed to configure WiFi");

      setConfigMessage(
        "Credentials sent — the box saves them and will use WiFi whenever Ethernet is unplugged."
      );
      setPassword("");
      setSelectedNetwork(null);

      // Re-poll status after a delay
      await new Promise((r) => setTimeout(r, 2000));
      await loadStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Configuration failed";
      setConfigError(message);
      console.error("[Device] Configure error:", err);
    } finally {
      setConfiguring(false);
    }
  };

  const isOnline = boardStatus.state === "online";
  const { relative: statusRelative, absolute: statusAbsolute } = formatRelativeTime(
    boardStatus.since
  );

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-8 md:px-12">
      {/* Header */}
      <div className="flex items-baseline justify-between pb-3.5 pt-6 md:pt-8">
        <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink">
          the box
        </h1>
        <span className="font-mono text-[11px] text-fern">out by the spigot</span>
      </div>

      {/* Board card */}
      <div className="card flex flex-col gap-3.5 border border-inputb p-4">
        <div className="flex items-center gap-3.5">
          <BoardIcon awake={isOnline} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
              KinCony KC868-E16P
            </h2>
            <span className="font-mono text-[11px] text-fern">
              irrigation-controller
              {firmwareInfo?.version ? ` · v${firmwareInfo.version}` : ""}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="flex items-center gap-2">
            <span
              className={`h-[9px] w-[9px] rounded-full ${
                isOnline ? "animate-pulse bg-leaflight" : "bg-clay"
              }`}
            />
            <span className={`text-[13px] font-bold ${isOnline ? "text-leaf" : "text-clay"}`}>
              {loading ? "…" : isOnline ? "Awake" : "Asleep"}
            </span>
          </span>
          <span className="text-[12px] text-fern">
            · {isOnline ? "on the wire since" : "last seen"} {statusRelative}
          </span>
          {statusAbsolute && (
            <span className="w-full font-mono text-[11px] text-stone">{statusAbsolute}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-0.5 rounded-[10px] bg-page px-3 py-2.5">
            <span className="text-[11px] text-fern">Connection</span>
            <span className="text-[13px] font-bold text-ink">
              {wifiStatus?.active === "ethernet"
                ? "Ethernet (PoE)"
                : wifiStatus?.active === "wifi"
                  ? `WiFi${wifiStatus.ssid ? ` (${wifiStatus.ssid})` : ""}`
                  : "—"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-[10px] bg-page px-3 py-2.5">
            <span className="text-[11px] text-fern">Address</span>
            <span className="font-mono text-[13px] text-ink">{wifiStatus?.ip || "—"}</span>
          </div>
        </div>
      </div>

      {/* Backup WiFi */}
      <div className="card mt-3.5 flex flex-col gap-3 border border-inputb p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
              Backup WiFi
            </h2>
            {wifiStatus?.configured ? (
              <span className="text-[11px] font-bold text-leaf">
                saved: {wifiStatus.configured}
              </span>
            ) : (
              <span className="text-[11px] text-warn">not set up yet</span>
            )}
          </div>
          <button
            onClick={handleScan}
            disabled={scanning || !isOnline}
            className="pill pill-soft h-11 shrink-0 border border-[#cfe0cf] px-4 text-[13px]"
          >
            {scanning ? "listening…" : "look for networks"}
          </button>
        </div>

        {scanError && (
          <div className="rounded-[10px] bg-claytint p-3 text-[12px] text-clay">{scanError}</div>
        )}

        {/* Networks list */}
        {networks.length > 0 && (
          <div className="flex flex-col gap-2">
            {networks.map((network) => {
              const selected = selectedNetwork === network.ssid;
              return (
                <div key={network.ssid} className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setSelectedNetwork(selected ? null : network.ssid);
                      setPassword("");
                      setConfigMessage("");
                      setConfigError("");
                    }}
                    className={`press flex min-h-[48px] items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left ${
                      selected
                        ? "border-[#cfe0cf] bg-tint"
                        : "border-hairline bg-page hover:bg-track"
                    }`}
                  >
                    <WifiIcon strong={strengthWord(network.rssi) === "strong"} active={selected} />
                    <span
                      className={`min-w-0 flex-1 truncate text-[14px] font-bold ${
                        selected ? "text-ink" : "text-sec"
                      }`}
                    >
                      {network.ssid}
                    </span>
                    <span className="font-mono text-[11px] text-fern">
                      {strengthWord(network.rssi)}
                    </span>
                    {network.secured && <LockIcon />}
                  </button>

                  {/* Password input */}
                  {selected && (
                    <div className="flex flex-col gap-2">
                      <input
                        type="password"
                        placeholder={`Password for ${network.ssid}`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={configuring}
                        className="h-12 w-full rounded-[10px] border border-inputb bg-page px-3.5 text-[14px] text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-leaflight disabled:opacity-50"
                      />
                      <button
                        onClick={() => handleConnect(network)}
                        disabled={configuring || !password}
                        className="pill pill-primary h-12 w-full text-[14px]"
                      >
                        {configuring ? "sending it out…" : "save to the box"}
                      </button>
                      {configError && (
                        <div className="text-[12px] text-clay">{configError}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {configMessage && (
          <div className="rounded-[10px] border border-[#cfe0cf] bg-tint p-3 text-[12px] text-leafdark">
            {configMessage}
          </div>
        )}

        {!scanning && networks.length === 0 && (
          <p className="py-2 text-center text-[12px] text-fern">
            {isOnline
              ? "tap “look for networks” to find nearby WiFi"
              : "the box must be awake on Ethernet before it can look for networks"}
          </p>
        )}

        <span className="text-[11px] leading-normal text-fern">
          Needs the box awake on Ethernet. Once saved, WiFi takes over on its own whenever the
          cable is out.
        </span>
      </div>
    </div>
  );
}
