"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string>("");
  const [state, setState] = useState<
    "confirm" | "submitting" | "done" | "error"
  >("confirm");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Capture token in memory and strip query string from browser address bar
  // so token-bearing URLs are not retained in browser history.
  useEffect(() => {
    const queryToken = searchParams.get("token")?.trim() ?? "";
    if (queryToken) {
      setToken(queryToken);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
  }, [searchParams]);

  const handleConfirmUnsubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setState("error");
      setErrorMessage("Invalid or expired unsubscribe link.");
      return;
    }

    setState("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/reminders/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (res.status === 204) {
        setState("done");
      } else {
        setState("error");
        setErrorMessage("Invalid or expired unsubscribe link.");
      }
    } catch {
      setState("error");
      setErrorMessage(
        "Unable to reach the server right now. Please try again."
      );
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            Unsubscribe from Email Reminders
          </h1>
          <p className="text-xs leading-relaxed text-[#475569]">
            Opening this page has not changed your settings yet. Confirm below
            to turn off deadline and attendance email reminders for your
            account.
          </p>
        </div>

        {state === "done" ? (
          <div
            role="status"
            className="rounded-[12px] border border-blue-200 bg-blue-50 p-4 text-xs font-medium text-blue-950 space-y-2"
          >
            <p>
              Email reminders have been turned off (or a newer preference on
              your account was preserved).
            </p>
            <p>
              You can review or re-enable reminders anytime in{" "}
              <Link
                href="/settings"
                className="font-semibold text-[#1D4ED8] hover:underline"
              >
                Account Settings
              </Link>
              .
            </p>
          </div>
        ) : (
          <form onSubmit={handleConfirmUnsubscribe} className="space-y-4">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-[12px] border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-900"
              >
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={state === "submitting" || !token}
              className="w-full rounded-[12px] bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              {state === "submitting"
                ? "Turning off reminders..."
                : "Confirm unsubscribe"}
            </button>

            {!token && state === "confirm" && (
              <p className="text-xs text-[#475569]">
                No unsubscribe token was provided in this link. Signed-in
                members can manage reminders directly in{" "}
                <Link
                  href="/settings"
                  className="font-semibold text-[#1D4ED8] hover:underline"
                >
                  Account Settings
                </Link>
                .
              </p>
            )}
          </form>
        )}

        <div className="border-t border-slate-100 pt-3 flex flex-wrap gap-4 text-xs">
          <Link
            href="/discover"
            className="font-semibold text-[#1D4ED8] hover:underline"
          >
            Browse Discover
          </Link>
          <Link
            href="/settings"
            className="font-semibold text-[#475569] hover:text-[#0F172A] hover:underline"
          >
            Account Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md rounded-[12px] border border-slate-200 bg-white p-6 text-xs text-[#475569]">
          Loading unsubscribe confirmation...
        </div>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  );
}
