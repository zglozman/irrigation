// Client-side invite form (settings page interactivity)

"use client";

import { useState } from "react";

export default function InviteForm() {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviting(true);

    try {
      const response = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send invite");
      }

      setInviteSuccess(`Invite sent to ${inviteEmail}`);
      setInviteEmail("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to invite";
      setInviteError(message);
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
      <h2 className="text-lg font-bold text-white">Invite User</h2>
      <p className="text-sm text-slate-400">Invite another user to access this system</p>

      {inviteError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {inviteError}
        </div>
      )}

      {inviteSuccess && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-sm">
          {inviteSuccess}
        </div>
      )}

      <form onSubmit={handleInvite} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-2">Email Address</label>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="user@example.com"
            required
            className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <button
          type="submit"
          disabled={inviting}
          className="w-full px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 text-white font-medium rounded transition-colors"
        >
          {inviting ? "Sending invite..." : "Send Invite"}
        </button>
      </form>

      <p className="text-xs text-slate-500 pt-2">
        The invited user will receive an email with a temporary password and a link to set their own
        password.
      </p>
    </div>
  );
}
