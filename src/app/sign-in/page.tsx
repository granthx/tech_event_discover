"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import { getPublicEnv } from "@/lib/env";
import { validateSameOriginReturnPath } from "@/lib/security/http";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

declare global {
  interface Window {
    turnstile?: {
      ready?: (cb: () => void) => void;
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      reset?: (widgetId?: string) => void;
    };
  }
}

function SignInContent() {
  const searchParams = useSearchParams();
  const returnTo = validateSameOriginReturnPath(searchParams.get("returnTo"));
  const pubEnv = getPublicEnv();

  const [alreadySignedIn, setAlreadySignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [otpStep, setOtpStep] = useState<"request" | "verify">("request");
  const [otpCode, setOtpCode] = useState("");
  const [otpAdultConfirmed, setOtpAdultConfirmed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const [scriptLoaded, setScriptLoaded] = useState(false);

  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  const [inviteTokenHash, setInviteTokenHash] = useState<string | null>(null);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Strip invite token hash from URL fragment and browser history before explicit submit (ARCHITECTURE.md)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rawHash = window.location.hash;
    if (rawHash && rawHash.length > 1) {
      const hashParams = new URLSearchParams(rawHash.slice(1));
      const tokenHash =
        hashParams.get("token_hash") ?? hashParams.get("invite_token");
      if (tokenHash) {
        setInviteTokenHash(tokenHash);
        window.history.replaceState(
          null,
          document.title,
          `${window.location.pathname}${window.location.search}`
        );
        return;
      }
    }

    // Check if caller already holds an active eligible session
    let canceled = false;
    fetch("/api/me/session", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) return { authenticated: false, eligible: false };
        return (await res.json()) as {
          authenticated: boolean;
          eligible: boolean;
        };
      })
      .then((s) => {
        if (!canceled && s.authenticated && s.eligible) {
          setAlreadySignedIn(true);
        }
      })
      .catch(() => {});

    return () => {
      canceled = true;
    };
  }, []);

  // Detect Turnstile script availability
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.turnstile) {
      setScriptLoaded(true);
      return;
    }
    const interval = window.setInterval(() => {
      if (window.turnstile) {
        setScriptLoaded(true);
        window.clearInterval(interval);
      }
    }, 150);
    return () => window.clearInterval(interval);
  }, []);

  // Render Cloudflare Turnstile widget on the OTP request form
  useEffect(() => {
    if (
      alreadySignedIn ||
      inviteTokenHash ||
      otpStep !== "request" ||
      !scriptLoaded ||
      !turnstileContainerRef.current ||
      !window.turnstile
    ) {
      return;
    }

    const mountWidget = () => {
      if (!turnstileContainerRef.current || !window.turnstile) return;
      turnstileContainerRef.current.innerHTML = "";
      widgetIdRef.current = window.turnstile.render(
        turnstileContainerRef.current,
        {
          sitekey: pubEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
          callback: (token: string) => {
            setCaptchaToken(token);
            setError(null);
          },
          "expired-callback": () => setCaptchaToken(""),
          "error-callback": () => {
            setCaptchaToken("");
            setError(
              "Security widget could not verify this browser. Refresh the page or check browser extensions."
            );
          },
        }
      );
    };

    if (typeof window.turnstile.ready === "function") {
      window.turnstile.ready(mountWidget);
    } else {
      mountWidget();
    }
  }, [
    alreadySignedIn,
    inviteTokenHash,
    otpStep,
    pubEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    scriptLoaded,
  ]);

  const handleSignOutHere = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
      });
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // Ignore
    } finally {
      setAlreadySignedIn(false);
      setSubmitting(false);
      window.location.assign("/sign-in");
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!captchaToken) {
      setError("Please complete the security check before requesting a code.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          captchaToken,
        }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? "Unable to request a sign-in code.");
        if (window.turnstile?.reset && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
          setCaptchaToken("");
        }
      } else {
        setOtpStep("verify");
        setMessage(
          data.message ??
            "If an invited account exists for that email address, a one-time code has been sent."
        );
      }
    } catch {
      setError("Network error while requesting sign-in code.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code: otpCode.trim(),
          ...(otpAdultConfirmed ? { adultConfirmed: true } : {}),
        }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? "Invalid or expired verification code.");
      } else {
        setMessage("Signed in! Redirecting...");
        window.location.assign(returnTo);
      }
    } catch {
      setError("Network error while verifying sign-in code.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!adultConfirmed) {
      setError("Please confirm that you are at least 18 years old.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenHash: inviteTokenHash,
          adultConfirmed: true,
        }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? "Unable to accept invitation.");
      } else {
        setMessage("Invitation accepted. Redirecting...");
        window.location.assign(returnTo);
      }
    } catch {
      setError("Network error while verifying invitation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (alreadySignedIn && !inviteTokenHash) {
    return (
      <div className="mx-auto max-w-md space-y-5 rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-[#0F172A]">
            You are signed in
          </h1>
          <p className="text-xs text-[#475569]">
            Your invited beta session is active on this browser.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/discover"
            className="rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Browse Discover
          </Link>
          <Link
            href="/my-events"
            className="rounded-[12px] border border-[#1D4ED8] bg-white px-4 py-2 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            My Events
          </Link>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSignOutHere}
            className="rounded-[12px] border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#475569] hover:text-[#0F172A] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {submitting ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() =>
          setError(
            "Cloudflare Turnstile could not load. Please disable content blockers for this site or refresh the page."
          )
        }
      />

      <div className="space-y-1">
        <h1 className="text-xl font-bold text-[#0F172A]">
          {inviteTokenHash
            ? "Accept Beta Invitation"
            : "Sign in to Tech Event Discover"}
        </h1>
        <p className="text-xs text-[#475569]">
          R1 is an invited curated beta. Public browsing on{" "}
          <Link
            href="/discover"
            className="font-semibold text-[#1D4ED8] hover:underline"
          >
            Discover
          </Link>{" "}
          requires no account.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-900"
        >
          {error}
        </div>
      )}

      {message && (
        <div
          role="status"
          className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-medium text-blue-950"
        >
          {message}
        </div>
      )}

      {inviteTokenHash ? (
        <form onSubmit={handleInviteSubmit} className="space-y-4">
          <div className="flex items-start gap-2.5">
            <input
              id="invite-adult-confirm"
              type="checkbox"
              checked={adultConfirmed}
              onChange={(e) => setAdultConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            />
            <label
              htmlFor="invite-adult-confirm"
              className="text-xs leading-normal text-[#0F172A]"
            >
              I confirm I am at least 18 years old.
            </label>
          </div>

          <p className="text-xs text-[#475569]">
            Review our{" "}
            <Link
              href="/privacy"
              className="font-semibold text-[#1D4ED8] hover:underline"
            >
              Privacy Notice
            </Link>{" "}
            before continuing.
          </p>

          <button
            type="submit"
            disabled={submitting || !adultConfirmed}
            className="w-full rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {submitting ? "Verifying invitation..." : "Accept invitation"}
          </button>
        </form>
      ) : otpStep === "request" ? (
        <form onSubmit={handleOtpSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="signin-email"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Invited email address
            </label>
            <input
              id="signin-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.org"
              className="mt-1 w-full rounded-[12px] border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            />
          </div>

          <div
            ref={turnstileContainerRef}
            role="group"
            aria-label="Security verification widget"
            className="min-h-[65px]"
          />

          <p className="text-xs text-[#475569]">
            By signing in, you acknowledge our{" "}
            <Link
              href="/privacy"
              className="font-semibold text-[#1D4ED8] hover:underline"
            >
              Privacy Notice
            </Link>
            .
          </p>

          <button
            type="submit"
            disabled={submitting || !captchaToken}
            className="w-full rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {submitting ? "Sending code..." : "Send one-time code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtpSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="signin-otp-code"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              One-time verification code sent to {email}
            </label>
            <input
              id="signin-otp-code"
              type="text"
              inputMode="numeric"
              pattern="\d{6,8}"
              maxLength={8}
              required
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="Enter 6-digit code"
              className="mt-1 w-full rounded-[12px] border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            />
          </div>

          <div className="flex items-start gap-2.5">
            <input
              id="otp-adult-confirm"
              type="checkbox"
              checked={otpAdultConfirmed}
              onChange={(e) => setOtpAdultConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            />
            <label
              htmlFor="otp-adult-confirm"
              className="text-xs leading-normal text-[#475569]"
            >
              I confirm I am at least 18 years old (required if completing an
              interrupted invitation).
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              {submitting ? "Verifying..." : "Verify & sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOtpStep("request");
                setOtpCode("");
                setError(null);
              }}
              className="rounded-[12px] border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#475569] hover:text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md rounded-[12px] border border-slate-200 bg-white p-6 text-center text-sm text-[#475569]">
          Loading sign-in...
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
