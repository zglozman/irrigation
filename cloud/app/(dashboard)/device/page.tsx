// Device page - WiFi setup and board status

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

function RelayBoardIcon(): React.ReactNode {
  return (
    <svg width="120" height="80" viewBox="0 0 120 80" className="text-current">
      {/* Board chassis */}
      <rect x="10" y="10" width="100" height="60" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />

      {/* Relay blocks (8 relays shown) */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <g key={i}>
          <rect x={18 + i * 11} y="20" width="9" height="20" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx={22.5 + i * 11} cy="32" r="1.5" fill="currentColor" />
        </g>
      ))}

      {/* Status LED (pulsing dot indicator area) */}
      <circle cx="105" cy="18" r="3" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function SignalBars({ rssi }: { rssi: number }): React.ReactNode {
  let bars = 1;
  if (rssi >= -55) bars = 4;
  else if (rssi >= -65) bars = 3;
  else if (rssi >= -75) bars = 2;

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className={`w-0.5 rounded-sm transition-colors ${
            i < bars ? "bg-teal-400" : "bg-slate-700"
          }`}
          style={{ height: `${(i + 1) * 3}px` }}
        />
      ))}
    </div>
  );
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
        "Credentials sent — the board saves them and will use WiFi whenever Ethernet is unplugged."
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
  const { relative: statusRelative, absolute: statusAbsolute } = formatRelativeTime(boardStatus.since);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Device</h1>
        <p className="text-slate-400">Board status and WiFi setup</p>
      </div>

      {/* Board Identity Card */}
      <div className="mb-6 p-6 bg-slate-900 border border-slate-800 rounded-lg">
        <div className="flex items-start gap-6 mb-6">
          {/* Board Icon */}
          <div className="text-slate-400 flex-shrink-0">
            <RelayBoardIcon />
          </div>

          {/* Board Info */}
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-white mb-1">KinCony KC868-E16P</h2>
            <div className="font-mono text-sm text-slate-400 mb-4">irrigation-controller</div>

            {/* Status Line */}
            <div className="flex items-start gap-3 mb-6">
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 mt-0.5 ${
                  isOnline ? "bg-teal-500 animate-pulse" : "bg-red-500"
                }`}
              />
              <div>
                <div className="font-medium text-white">
                  {isOnline ? "Online" : "Offline"} — {isOnline ? "connected since" : "last seen"}{" "}
                  <span className="text-teal-400">{statusRelative}</span>
                </div>
                {statusAbsolute && (
                  <div className="text-xs font-mono text-slate-500 mt-1">{statusAbsolute}</div>
                )}
              </div>
            </div>

            {/* Details Grid */}
            {wifiStatus && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                {wifiStatus.active && (
                  <div>
                    <div className="text-slate-400">Active Interface</div>
                    <div className="text-white font-medium capitalize">{wifiStatus.active}</div>
                  </div>
                )}

                {wifiStatus.ip && (
                  <div>
                    <div className="text-slate-400">IP Address</div>
                    <div className="text-white font-mono">{wifiStatus.ip}</div>
                  </div>
                )}

                {wifiStatus.ssid && (
                  <div>
                    <div className="text-slate-400">WiFi SSID</div>
                    <div className="text-white font-medium">{wifiStatus.ssid}</div>
                  </div>
                )}

                {wifiStatus.configured && (
                  <div>
                    <div className="text-slate-400">Configured SSID</div>
                    <div className="text-white font-medium">{wifiStatus.configured}</div>
                  </div>
                )}

                {firmwareInfo && (
                  <div>
                    <div className="text-slate-400">Firmware Version</div>
                    <div className="text-white font-mono">
                      {firmwareInfo.version || "—"}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* WiFi Setup Card */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-lg">
        <h2 className="text-lg font-semibold text-white mb-4">WiFi Setup</h2>

        <p className="text-sm text-slate-400 mb-6">
          WiFi setup requires the board to be currently online (via Ethernet).
        </p>

        {/* Scan Button */}
        <button
          onClick={handleScan}
          disabled={scanning || !isOnline}
          className={`w-full px-4 py-2 rounded-lg font-medium transition-colors mb-6 ${
            isOnline
              ? "bg-teal-600 hover:bg-teal-700 text-white"
              : "bg-slate-700 text-slate-500 cursor-not-allowed"
          }`}
        >
          {scanning ? "Scanning..." : "Scan for Networks"}
        </button>

        {scanError && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
            {scanError}
          </div>
        )}

        {/* Networks List */}
        {networks.length > 0 && (
          <div className="mb-6 space-y-2">
            {networks.map((network) => (
              <div key={network.ssid}>
                <button
                  onClick={() => {
                    setSelectedNetwork(
                      selectedNetwork === network.ssid ? null : network.ssid
                    );
                    setPassword("");
                    setConfigMessage("");
                    setConfigError("");
                  }}
                  className="w-full p-3 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-between transition-colors text-left"
                >
                  <div className="flex-1">
                    <div className="font-medium text-white flex items-center gap-2">
                      {network.ssid}
                      {network.secured && <span>🔒</span>}
                    </div>
                    <div className="text-xs text-slate-400">{network.rssi} dBm</div>
                  </div>
                  <SignalBars rssi={network.rssi} />
                </button>

                {/* Password Input */}
                {selectedNetwork === network.ssid && (
                  <div className="mt-2 p-3 bg-slate-800 rounded-lg space-y-2">
                    <input
                      type="password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={configuring}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
                    />

                    <button
                      onClick={() => handleConnect(network)}
                      disabled={configuring || !password}
                      className="w-full px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 text-white rounded font-medium transition-colors disabled:opacity-50"
                    >
                      {configuring ? "Connecting..." : "Connect"}
                    </button>

                    {configError && (
                      <div className="text-sm text-red-400">{configError}</div>
                    )}

                    {configMessage && (
                      <div className="text-sm text-teal-400">{configMessage}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!scanning && networks.length === 0 && (
          <div className="text-center py-6 text-slate-400 text-sm">
            {isOnline
              ? "Click 'Scan for Networks' to find available WiFi networks"
              : "Board must be online to scan networks"}
          </div>
        )}
      </div>
    </div>
  );
}
