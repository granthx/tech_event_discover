import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-4">
        <Link
          href="/discover"
          className="text-lg font-bold tracking-tight text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
        >
          Tech Event Discover
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex flex-wrap items-center gap-3 text-sm font-medium text-[#475569]"
        >
          <Link
            href="/discover"
            className="rounded px-2 py-1 text-[#0F172A] hover:text-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Discover
          </Link>
          <Link
            href="/my-events"
            className="rounded px-2 py-1 hover:text-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            My Events
          </Link>
          <Link
            href="/settings"
            className="rounded px-2 py-1 hover:text-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Settings
          </Link>
          <Link
            href="/privacy"
            className="rounded px-2 py-1 hover:text-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Privacy
          </Link>
          <Link
            href="/sign-in"
            className="rounded-[12px] border border-[#1D4ED8] px-3 py-1.5 text-[#1D4ED8] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
