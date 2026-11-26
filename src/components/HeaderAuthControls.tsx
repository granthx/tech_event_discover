"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface SessionStatus {
  authenticated: boolean;
  eligible: boolean;
  isCurator: boolean;
}

export function HeaderAuthControls() {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionStatus>({
    authenticated: false,
    eligible: false,
    isCurator: false,
  });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let canceled = false;

    fetch("/api/me/session", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) {
          return { authenticated: false, eligible: false, isCurator: false };
        }
        return (await res.json()) as SessionStatus;
      })
      .then((data) => {
        if (!canceled) {
          setSession(data);
        }
      })
      .catch(() => {});

    return () => {
      canceled = true;
    };
  }, [pathname]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
      });
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // Proceed to refresh regardless
    } finally {
      setSession({ authenticated: false, eligible: false, isCurator: false });
      setSigningOut(false);
      window.location.assign("/discover");
    }
  };

  if (session.authenticated) {
    return (
      <>
        {session.isCurator && (
          <Link
            href="/admin/events"
            className="rounded px-2 py-1 font-semibold text-[#1D4ED8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Curator
          </Link>
        )}
        <button
          type="button"
          disabled={signingOut}
          onClick={handleSignOut}
          className="rounded-[12px] border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-[#0F172A] hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
        >
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </>
    );
  }

  // Use full document navigation (<a href>) to /sign-in so the browser always receives
  // /sign-in's dedicated Turnstile CSP headers rather than inheriting /discover's fixed CSP.
  return (
    <a
      href="/sign-in"
      className="rounded-[12px] border border-[#1D4ED8] px-3 py-1.5 text-[#1D4ED8] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
    >
      Sign in
    </a>
  );
}
