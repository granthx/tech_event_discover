import type { Metadata } from "next";
import { getServerEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description:
    "Privacy notice, data retention, processors, account age policy, and how to request access or deletion.",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  const env = getServerEnv();

  return (
    <article className="mx-auto max-w-3xl space-y-6 rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-[#0F172A]">Privacy Notice</h1>
        <p className="text-sm text-[#475569]">
          Personally operated, non-commercial curated beta for discovering tech events accessible from India.
        </p>
      </div>

      <section className="space-y-2 text-sm text-[#475569]">
        <h2 className="text-base font-semibold text-[#0F172A]">
          Responsible Owner & Grievance Contact
        </h2>
        <p>
          <strong>Responsible Owner:</strong> {env.PUBLIC_OWNER_NAME}
        </p>
        <p>
          <strong>Monitored Grievance & Correction Contact:</strong>{" "}
          <a
            href={`mailto:${env.PUBLIC_CONTACT_EMAIL}`}
            className="font-semibold text-[#1D4ED8] hover:underline"
          >
            {env.PUBLIC_CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <section className="space-y-2 text-sm text-[#475569]">
        <h2 className="text-base font-semibold text-[#0F172A]">
          Account Age Policy & Minimal Data Collection
        </h2>
        <p>
          Guests may browse the public catalog and download calendar files without an account.
          Invited member accounts require confirming that you are at least 18 years old
          (&ldquo;I confirm I am at least 18 years old.&rdquo;). We store only the first confirmed
          timestamp and collect neither your date of birth nor device GPS coordinates.
          City filtering is stored purely in the Discover URL.
        </p>
      </section>

      <section className="space-y-2 text-sm text-[#475569]">
        <h2 className="text-base font-semibold text-[#0F172A]">
          Data Uses, Processors & Retention
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Authentication & Member Tracking:</strong> Your verified email address
            lives in Supabase Auth. Saved and Registered tracking rows and optional email
            reminder preferences belong to your account.
          </li>
          <li>
            <strong>Optional Email Reminders:</strong> Deadline and attendance reminders are
            off by default and sent only if you explicitly opt in under Settings. Every reminder
            includes one-click unsubscribe headers and a read-only confirmation link.
          </li>
          <li>
            <strong>Infrastructure Processors:</strong> Hosted on Vercel (web delivery) and
            Supabase (Postgres database & authentication), with Cloudflare Turnstile for
            bot protection, Resend for opt-in reminder delivery, and Healthchecks.io for
            safe job-health monitoring (status codes and check IDs only).
          </li>
          <li>
            <strong>Retention Schedule:</strong> Private curator audit records are retained
            for 180 days; OTP and mutation rate-limit buckets for 24 hours; encrypted database
            backups for 30 days; job run logs for 30 days; reminder delivery keys and unsubscribe
            digests for 90 days; permanent-bounce suppressions for 90 days; and complaint
            suppressions for 180 days. Temporary reminder request payloads are cleared on
            terminal completion or within 23 hours of first attempt.
          </li>
        </ul>
      </section>

      <section className="space-y-2 text-sm text-[#475569]">
        <h2 className="text-base font-semibold text-[#0F172A]">
          Access, Correction & Account Deletion
        </h2>
        <p>
          Signed-in members can request immediate in-app account deletion from Settings after
          verifying a fresh one-time passcode (OTP). Account deletion cascades all user-linked
          tracking data and retains only an opaque user UUID and request timestamp in a separate
          35-day deletion tombstone so a 30-day backup restore cannot reinstate a deleted account.
          You may also contact{" "}
          <a
            href={`mailto:${env.PUBLIC_CONTACT_EMAIL}`}
            className="font-semibold text-[#1D4ED8] hover:underline"
          >
            {env.PUBLIC_CONTACT_EMAIL}
          </a>{" "}
          for data access, correction, or takedown requests.
        </p>
      </section>
    </article>
  );
}
