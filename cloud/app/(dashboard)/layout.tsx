// Dashboard layout with sidebar navigation

"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { ChatWidget } from "@/components/chat/ChatWidget";

function NavIcon({ icon }: { icon: "dashboard" | "zones" | "settings" | "weather" | "switches" | "device" }) {
  switch (icon) {
    case "dashboard":
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
          <path d="M3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z" />
          <path d="M14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
        </svg>
      );
    case "zones":
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2h4a1 1 0 001-1V4a1 1 0 00-1-1H5z" />
          <path d="M14 7a1 1 0 00-1 1v6a2 2 0 002 2h2a2 2 0 002-2v-4a1 1 0 00-1-1h-4z" />
        </svg>
      );
    case "settings":
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "weather":
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 20 20">
          <path d="M4.3 12.98a8 8 0 1011.55-8.42M9.5 4.5a4 4 0 100 8 4 4 0 000-8z" />
        </svg>
      );
    case "switches":
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
        </svg>
      );
    case "device":
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 20 20">
          <path d="M4 3a1 1 0 00-1 1v11a1 1 0 001 1h2l1 2h6l1-2h2a1 1 0 001-1V4a1 1 0 00-1-1H4z" />
        </svg>
      );
  }
}

function NavLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: "dashboard" | "zones" | "settings" | "weather" | "switches" | "device";
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
        active
          ? "bg-teal-600 text-white"
          : "text-slate-400 hover:bg-slate-800 hover:text-white"
      }`}
    >
      <NavIcon icon={icon} />
      <span className="font-medium">{label}</span>
    </Link>
  );
}

function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="w-full text-left px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors font-medium flex items-center space-x-3"
    >
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
          clipRule="evenodd"
        />
      </svg>
      <span>{loading ? "Logging out..." : "Log out"}</span>
    </button>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen bg-slate-950">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-bold text-white">Irrigation</h1>
          <p className="text-slate-400 text-xs mt-1">Control System</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          <NavLink
            href="/"
            icon="dashboard"
            label="Dashboard"
            active={pathname === "/"}
          />
          <NavLink
            href="/zones"
            icon="zones"
            label="Zones"
            active={pathname.startsWith("/zones")}
          />
          <NavLink
            href="/weather"
            icon="weather"
            label="Weather"
            active={pathname === "/weather"}
          />
          <NavLink
            href="/switches"
            icon="switches"
            label="Switchboard"
            active={pathname === "/switches"}
          />
          <NavLink
            href="/device"
            icon="device"
            label="Device"
            active={pathname === "/device"}
          />
          <NavLink
            href="/settings"
            icon="settings"
            label="Settings"
            active={pathname === "/settings"}
          />
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-slate-800">
          <LogoutButton />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <div className="h-full bg-slate-950">{children}</div>
      </div>

      {/* Chat Widget */}
      <ChatWidget />
    </div>
  );
}
