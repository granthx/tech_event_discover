"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const [deleteStep, setDeleteStep] = useState<"idle" | "awaiting_otp" | "deleted">(
    "idle"
  );
  const [otpCode, setOtpCode] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSignOut = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setSubmitting(true);
    try {
      await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
      });
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      setStatusMsg("Signed out of your session.");
      window.location.assign("/discover");
    } catch {
      setErrorMsg("Could not sign out cleanly.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestDeletionOtp = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/me/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setErrorMsg(
          data.message ?? "Please sign in before requesting account deletion."
        );
      } else {
        setDeleteStep("awaiting_otp");
        setStatusMsg(
          data.message ??
            "A fresh confirmation code has been sent to your verified email address."
        );
      }
    } catch {
      setErrorMsg("Network error while requesting deletion verification code.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDeletion = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/me/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", code: otpCode }),
      });

      if (res.status === 204) {
        setDeleteStep("deleted");
        setStatusMsg("Your account and tracking data have been deleted.");
      } else {
        const data = (await res.json()) as { message?: string };
        setErrorMsg(data.message ?? "Unable to confirm account deletion.");
      }
    } catch {
      setErrorMsg("Network error while confirming account deletion.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
          Account Settings
        </h1>
        <p className="text-sm text-[#475569]">
          Manage your invited beta session and account data. Review our{" "}
          <Link
            href="/privacy"
            className="font-semibold text-[#1D4ED8] hover:underline"
          >
            Privacy Notice
          </Link>{" "}
          for retention and deletion details.
        </p>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-900"
        >
          {errorMsg}
        </div>
      )}

      {statusMsg && (
        <div
          role="status"
          className="rounded-[12px] border border-blue-200 bg-blue-50 p-4 text-xs font-medium text-blue-950"
        >
          {statusMsg}
        </div>
      )}

      {/* Session Sign-Out Section */}
      <section
        aria-label="Session controls"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs"
      >
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-[#0F172A]">Session</h2>
          <p className="text-xs text-[#475569]">
            Sign out of your invited beta account on this browser.
          </p>
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={handleSignOut}
          className="rounded-[12px] border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
        >
          Sign out
        </button>
      </section>

      {/* Permanent Account Deletion Section (R1-MUST) */}
      <section
        aria-label="Delete account"
        className="space-y-4 rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs"
      >
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-[#0F172A]">
            Delete Account
          </h2>
          <p className="text-xs leading-relaxed text-[#475569]">
            Deleting your account requires a fresh one-time passcode (OTP),
            immediately blocks ordinary writes, cascades all your Saved and
            Registered tracking rows, and records only an opaque user UUID and
            request timestamp in a separate 35-day tombstone so a 30-day backup
            restore cannot silently reinstate your deleted account.
          </p>
        </div>

        {deleteStep === "idle" && (
          <button
            type="button"
            disabled={submitting}
            onClick={handleRequestDeletionOtp}
            className="rounded-[12px] border border-red-700 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {submitting
              ? "Sending confirmation code..."
              : "Request deletion verification code"}
          </button>
        )}

        {deleteStep === "awaiting_otp" && (
          <form onSubmit={handleConfirmDeletion} className="space-y-3">
            <div>
              <label
                htmlFor="deletion-otp-code"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Deletion confirmation code
              </label>
              <input
                id="deletion-otp-code"
                type="text"
                inputMode="numeric"
                pattern="\d{6,8}"
                maxLength={8}
                required
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="Enter code"
                className="mt-1 w-48 rounded-[12px] border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-[12px] bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                {submitting
                  ? "Deleting account..."
                  : "Confirm permanent account deletion"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteStep("idle")}
                className="rounded-[12px] border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#475569] hover:text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
