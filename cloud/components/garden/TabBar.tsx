// TabBar — mobile bottom navigation (Terraced Beds design).
// Five items: garden / beds / journal / valves / more. Translucent layer
// with content scrolling underneath; "more" opens a small menu anchored
// to its trigger (weather, the box, settings, log out).

"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

function TabIcon({ icon, active }: { icon: "garden" | "beds" | "journal" | "valves" | "more"; active: boolean }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  void active;
  switch (icon) {
    case "garden":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case "beds":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
          <rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "journal":
      return (
        <svg {...common}>
          <path d="M3 12h4l3-8 4 16 3-8h4" />
        </svg>
      );
    case "valves":
      return (
        <svg {...common}>
          <rect x="3" y="8" width="18" height="8" rx="4" />
          <circle cx="16" cy="12" r="2.5" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      );
  }
}

const tabClass = (active: boolean) =>
  `press flex min-h-[44px] flex-1 flex-col items-center justify-center gap-[3px] ${
    active ? "text-leaf" : "text-inactive"
  }`;

export function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const moreActive =
    pathname === "/weather" || pathname === "/device" || pathname === "/settings";

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  };

  return (
    <nav
      className="glass fixed inset-x-0 bottom-0 z-30 flex h-[76px] items-stretch rounded-t-[24px] pb-3 [box-shadow:0_-4px_16px_#24382a0f] md:hidden"
      aria-label="garden navigation"
    >
      <Link href="/" className={tabClass(pathname === "/")}>
        <TabIcon icon="garden" active={pathname === "/"} />
        <span className="text-[11px] font-bold">garden</span>
      </Link>
      <Link href="/zones" className={tabClass(pathname.startsWith("/zones"))}>
        <TabIcon icon="beds" active={pathname.startsWith("/zones")} />
        <span className="text-[11px] font-bold">beds</span>
      </Link>
      <Link href="/activity" className={tabClass(pathname === "/activity")}>
        <TabIcon icon="journal" active={pathname === "/activity"} />
        <span className="text-[11px] font-bold">journal</span>
      </Link>
      <Link href="/switches" className={tabClass(pathname === "/switches")}>
        <TabIcon icon="valves" active={pathname === "/switches"} />
        <span className="text-[11px] font-bold">valves</span>
      </Link>
      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        className={tabClass(moreActive || moreOpen)}
        aria-label="more"
        aria-expanded={moreOpen}
      >
        <TabIcon icon="more" active={moreActive} />
        <span className="text-[11px] font-bold">more</span>
      </button>

      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setMoreOpen(false)}
          />
          {/* menu scales from its trigger (bottom-right) */}
          <div className="anim-pop absolute bottom-full right-3 z-50 mb-2 flex w-44 flex-col overflow-hidden rounded-[16px] bg-white py-1 [box-shadow:0_8px_28px_#24382a1f]">
            <Link
              href="/weather"
              onClick={() => setMoreOpen(false)}
              className={`press flex h-11 items-center px-4 text-[14px] font-semibold ${
                pathname === "/weather" ? "text-leafdark" : "text-sec"
              }`}
            >
              weather
            </Link>
            <Link
              href="/device"
              onClick={() => setMoreOpen(false)}
              className={`press flex h-11 items-center px-4 text-[14px] font-semibold ${
                pathname === "/device" ? "text-leafdark" : "text-sec"
              }`}
            >
              the box
            </Link>
            <Link
              href="/settings"
              onClick={() => setMoreOpen(false)}
              className={`press flex h-11 items-center px-4 text-[14px] font-semibold ${
                pathname === "/settings" ? "text-leafdark" : "text-sec"
              }`}
            >
              settings
            </Link>
            <div className="mx-4 my-1 h-px bg-hairline" />
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="press flex h-11 items-center px-4 text-left text-[14px] font-semibold text-clay disabled:opacity-50"
            >
              {loggingOut ? "leaving…" : "log out"}
            </button>
          </div>
        </>
      )}
    </nav>
  );
}
