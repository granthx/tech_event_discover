"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function CuratorMfaPanel() {
  const [aal, setAal] = useState<string | null>(null);
  const [nextAal, setNextAal] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrSvgDataUrl, setQrSvgDataUrl] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshAal = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData) {
        setAal(aalData.currentLevel);
        setNextAal(aalData.nextLevel);
      }
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verifiedTotp = factorsData?.totp?.find(
        (f) => f.status === "verified"
      );
      if (verifiedTotp) {
        setFactorId(verifiedTotp.id);
      }
    } catch {
      // Ignore if unauthenticated or placeholder env
    }
  }, []);

  useEffect(() => {
    void refreshAal();
  }, [refreshAal]);

  const handleEnrollTotp = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Tech Event Discover Curator TOTP",
      });
      if (error || !data) {
        setErrorMsg(error?.message ?? "Could not start TOTP enrollment.");
        return;
      }
      setFactorId(data.id);
      setQrSvgDataUrl(data.totp.qr_code);
      setTotpSecret(data.totp.secret);
      setStatusMsg(
        "Scan the QR code (or enter the secret) in your authenticator app, then enter the 6-digit code below."
      );
    } catch {
      setErrorMsg("Unexpected error starting TOTP enrollment.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) {
      setErrorMsg("Enroll or select a TOTP factor first.");
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setCode("");
      setQrSvgDataUrl(null);
      setTotpSecret(null);
      setStatusMsg("Session upgraded to verified TOTP (aal2).");
      await refreshAal();
    } catch {
      setErrorMsg("Unexpected error verifying TOTP code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Curator two-factor authentication"
      className="space-y-4 rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[#0F172A]">
            Curator 2FA Assurance (TOTP)
          </h2>
          <p className="text-xs text-[#475569]">
            Current session assurance:{" "}
            <strong className="text-[#0F172A]">{aal ?? "not signed in"}</strong>
            {nextAal && nextAal !== aal ? ` (required: ${nextAal})` : ""}
          </p>
        </div>

        {aal !== "aal2" && !factorId && (
          <button
            type="button"
            disabled={busy}
            onClick={handleEnrollTotp}
            className="rounded-[12px] border border-[#1D4ED8] bg-white px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {busy ? "Starting..." : "Enroll Authenticator App (TOTP)"}
          </button>
        )}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-900"
        >
          {errorMsg}
        </div>
      )}

      {statusMsg && (
        <div
          role="status"
          className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-medium text-blue-950"
        >
          {statusMsg}
        </div>
      )}

      {qrSvgDataUrl && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-[#F8FAFC] p-4">
          <img
            src={qrSvgDataUrl}
            alt="TOTP authenticator setup QR code"
            className="h-44 w-44 rounded border border-slate-200 bg-white p-2"
          />
          {totpSecret && (
            <p className="text-xs text-[#475569] break-all">
              Manual setup key: <code className="font-mono text-[#0F172A]">{totpSecret}</code>
            </p>
          )}
        </div>
      )}

      {aal !== "aal2" && factorId && (
        <form onSubmit={handleVerifyTotp} className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="curator-totp-code"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              6-digit authenticator code
            </label>
            <input
              id="curator-totp-code"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {busy ? "Verifying..." : "Verify & Upgrade to aal2"}
          </button>
        </form>
      )}
    </section>
  );
}
