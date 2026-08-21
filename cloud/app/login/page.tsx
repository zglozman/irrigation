// Login page
// Dark-mode-first design, handles initial login and NEW_PASSWORD_REQUIRED challenge

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-lg shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Irrigation</h1>
            <p className="text-slate-400 text-sm">Smart watering control</p>
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
              {error}
            </div>
          )}

          {!challenge ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 text-white font-medium rounded transition-colors"
              >
                {loading ? "Logging in..." : "Log in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleChallenge} className="space-y-4">
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 text-sm mb-4">
                First login: please set a new password
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 text-white font-medium rounded transition-colors"
              >
                {loading ? "Setting password..." : "Set password and continue"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-slate-500 text-sm mt-6">
          Invite-only access • Contact your administrator
        </p>
      </div>
    </div>
  );
}
