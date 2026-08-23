// Dashboard layout — desktop left rail + mobile bottom tab bar
// (Terraced Beds design)

"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { ActivityBadge } from "@/components/ActivityBadge";
import { TabBar } from "@/components/garden/TabBar";

function RailLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`press flex h-[42px] items-center rounded-[10px] px-3.5 text-[14px] ${
        active
          ? "bg-tint font-semibold text-leafdark"
          : "text-fern hover:bg-tint/60 hover:text-sec"
      }`}
    >
      {label}
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
      className="press flex h-[42px] w-full items-center rounded-[10px] px-3.5 text-left text-[14px] text-fern hover:bg-claytint hover:text-clay disabled:opacity-50"
    >
      {loading ? "leaving…" : "log out"}
    </button>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-page md:flex">
      {/* Desktop rail */}
      <aside className="glass sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col gap-7 px-[22px] py-7 [box-shadow:4px_0_16px_#24382a08] md:flex">
        <Link
          href="/"
          className="press font-display text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink"
        >
          sprout
        </Link>

        <nav className="flex flex-col gap-1">
          <RailLink href="/" label="garden" active={pathname === "/"} />
          <RailLink href="/zones" label="beds" active={pathname.startsWith("/zones")} />
          <RailLink href="/activity" label="journal" active={pathname === "/activity"} />
          <RailLink href="/switches" label="valves" active={pathname === "/switches"} />
          <RailLink href="/weather" label="weather" active={pathname === "/weather"} />
          <RailLink href="/device" label="the box" active={pathname === "/device"} />
          <RailLink href="/settings" label="settings" active={pathname === "/settings"} />
        </nav>

        <div className="flex-1" />

        <ActivityBadge />
        <LogoutButton />
      </aside>

      {/* Main content — scrolls under the translucent tab bar on mobile */}
      <main className="min-w-0 flex-1 pb-[108px] md:pb-0">{children}</main>

      {/* Mobile tab bar */}
      <TabBar />

      {/* Chat Widget */}
      <ChatWidget />
    </div>
  );
}
