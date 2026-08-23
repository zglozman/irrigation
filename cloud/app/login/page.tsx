// Login page — the garden gate.
// Handles initial login and the NEW_PASSWORD_REQUIRED challenge.

"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h5.9c-.3 1.4-1 2.5-2.2 3.3v2.8h3.6c2.1-2 3.3-4.9 3.3-8.2z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.6H2.1v2.9C3.9 20.5 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.8 14c-.2-.7-.4-1.4-.4-2s.1-1.4.4-2V7.1H2.1C1.4 8.6 1 10.2 1 12s.4 3.4 1.1 4.9L5.8 14z"
      />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2C17.5 2.1 15 1 12 1 7.7 1 3.9 3.5 2.1 7.1L5.8 10c.9-2.7 3.3-4.6 6.2-4.6z"
      />
    </svg>
  );
}

const inputClass =
  "h-[50px] w-full rounded-[12px] border border-inputb bg-white px-4 text-[15px] text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-leaflight";

const GOOGLE_ERRORS: Record<string, string> = {
  "not-invited":
    "this garden is invite-only — that google account hasn't been invited yet.",
  "google-failed":
    "google sign-in didn't go through. try again or use your password.",
};

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryError = GOOGLE_ERRORS[searchParams.get("error") ?? ""] || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<{
    session: string;
    challengeUsername: string;
    userAttributes: Record<string, string>;
  } | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }

      if (data.challenge === "NEW_PASSWORD_REQUIRED") {
        setChallenge({
          session: data.session,
          challengeUsername: data.challengeUsername,
          userAttributes: data.userAttributes,
        });
        setPassword("");
        setLoading(false);
        return;
      }

      // Successful login
      router.push("/");
    } catch (err) {
      setError("An error occurred during login");
      console.error(err);
      setLoading(false);
    }
  };

  const handleChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeUsername: challenge?.challengeUsername,
          newPassword,
          session: challenge?.session,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Challenge failed");
        setLoading(false);
        return;
      }

      // Success
      router.push("/");
    } catch (err) {
      setError("An error occurred");
      console.error(err);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-page">
      {/* Dawn arc as welcome */}
      <div className="flex flex-col items-center rounded-b-[28px] bg-gradient-to-br from-[#dff0d8] via-[#cfe8cf] to-[#c3e2cd] px-6 pb-8 pt-14">
        <svg width="300" height="96" viewBox="0 0 300 96" fill="none" aria-hidden="true">
          <line x1="0" y1="80" x2="300" y2="80" stroke="#cfe0cf" strokeWidth="1" />
          <path d="M 10 80 Q 150 -24 290 80" stroke="#cfe0cf" strokeWidth="1" strokeDasharray="3 5" />
          <circle cx="150" cy="28" r="11" fill="#e9b949" />
          <circle cx="150" cy="28" r="17" fill="#e9b94933" />
          <path d="M120 80 Q 128 62 150 64 Q 172 62 180 80 Z" fill="#57b46f" />
        </svg>
        <h1 className="mt-1.5 font-display text-[40px] font-bold leading-none tracking-[-0.02em] text-ink">
          sprout
        </h1>
        <p className="mt-2 text-[13px] text-sec">your garden, watered wisely</p>
      </div>

      {/* Sign-in */}
      <div className="mx-auto flex w-full max-w-sm flex-col gap-3 px-[30px] pt-8">
        {(error || queryError) && (
          <div className="rounded-[12px] bg-claytint p-3 text-sm text-clay">
            {error || queryError}
          </div>
        )}

        {!challenge ? (
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-sec" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-sec" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="pill pill-primary mt-1.5 h-[52px] w-full text-[15px]"
            >
              {loading ? "opening the gate…" : "step into the garden"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleChallenge} className="flex flex-col gap-3">
            <div className="rounded-[12px] border border-inputb bg-tint p-3 text-sm text-leafdark">
              First visit — pick a new password to keep.
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-sec" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                required
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-sec" htmlFor="confirm-password">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="pill pill-primary mt-1.5 h-[52px] w-full text-[15px]"
            >
              {loading ? "planting it…" : "set password and step in"}
            </button>
          </form>
        )}

        {!challenge && (
          <>
            <div className="my-1.5 flex items-center gap-3">
              <div className="h-px flex-1 bg-inputb" />
              <span className="text-[11px] text-stone">or</span>
              <div className="h-px flex-1 bg-inputb" />
            </div>

            <a
              href="/api/auth/google"
              className="pill flex h-[52px] w-full items-center justify-center gap-2.5 border border-inputb bg-white text-[15px] font-bold text-ink hover:bg-track"
            >
              <GoogleG />
              continue with google
            </a>
          </>
        )}

        <p className="mt-2.5 text-center text-[12px] text-fern">This garden is invite-only.</p>
      </div>

      <div className="flex-1" />

      {/* Soil footer */}
      <svg
        viewBox="0 0 390 110"
        fill="none"
        preserveAspectRatio="none"
        className="block h-[110px] w-full"
        aria-hidden="true"
      >
        <path d="M0 38 Q 60 26 120 34 T 250 30 T 390 36 L 390 110 L 0 110 Z" fill="#e3f2e0" />
        <path d="M0 58 Q 70 48 140 55 T 280 52 T 390 57 L 390 110 L 0 110 Z" fill="#cfe0cf" />
        <path d="M0 82 Q 80 74 160 80 T 320 78 T 390 81 L 390 110 L 0 110 Z" fill="#c9ab84" />
      </svg>
    </div>
  );
}
