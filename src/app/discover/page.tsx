import { Suspense } from "react";
import type { Metadata } from "next";
import { DiscoverClient } from "@/components/DiscoverClient";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Discover Tech Events in India",
  description:
    "Search and filter verified hackathons, workshops, meetups, seminars, and conferences across India and online.",
  alternates: {
    canonical: "/discover",
  },
  openGraph: {
    title: "Discover Tech Events in India · Tech Event Discover",
    description:
      "Search and filter verified hackathons, workshops, meetups, seminars, and conferences across India and online.",
    type: "website",
    url: "/discover",
  },
};

export default function DiscoverPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
          Discover Tech Events
        </h1>
        <p className="text-sm text-[#475569]">
          Verified hackathons, workshops, meetups, seminars, and conferences you can attend from India.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="rounded-[12px] border border-slate-200 bg-white p-8 text-center text-sm text-[#475569]">
            Loading event catalog...
          </div>
        }
      >
        <DiscoverClient />
      </Suspense>
    </div>
  );
}
