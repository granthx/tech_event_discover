import type { Metadata } from "next";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Tech Event Discover · Curated Tech Events for India",
    template: "%s · Tech Event Discover",
  },
  description:
    "Discover verified hackathons, workshops, meetups, seminars, and conferences you can attend from India.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F8FAFC] text-[#0F172A] antialiased">
        <Header />
        <main className="mx-auto max-w-[1200px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
