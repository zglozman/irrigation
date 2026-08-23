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
    <div className="card flex flex-col gap-3.5 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
          Open the gate
        </h2>
        <p className="text-[12px] text-fern">invite someone else into the garden</p>
      </div>

      {inviteError && (
        <div className="rounded-[10px] bg-claytint p-3 text-[12px] text-clay">{inviteError}</div>
      )}

      {inviteSuccess && (
        <div className="rounded-[10px] border border-inputb bg-tint p-3 text-[12px] text-leafdark">
          {inviteSuccess}
        </div>
      )}

      <form onSubmit={handleInvite} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-bold text-sec" htmlFor="invite-email">
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="user@example.com"
            required
            className="h-[46px] w-full rounded-[10px] border border-inputb bg-white px-3.5 text-[14px] text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-leaflight"
          />
        </div>

        <button
          type="submit"
          disabled={inviting}
          className="pill pill-primary h-12 w-full text-[14px]"
        >
          {inviting ? "sending it out…" : "send an invite"}
        </button>
      </form>

      <p className="text-[11px] leading-normal text-fern">
        The invited user will receive an email with a temporary password and a link to set their
        own password.
      </p>
    </div>
  );
}
