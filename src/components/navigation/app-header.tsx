import Link from "next/link";
import { Bell, LogOut, Search, UserRound } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { signOut } from "@/features/auth/actions";

const destinations = [
  { href: "/home", label: "Home" },
  { href: "/network", label: "My Network" },
  { href: "/jobs", label: "Jobs" },
  { href: "/community", label: "Community" },
  { href: "/learn", label: "Learn" },
  { href: "/events", label: "Events" },
];

export function AppHeader() {
  return (
    <header className="hidden border-b border-mist-100 bg-white md:block">
      <div className="mx-auto flex min-h-18 w-full max-w-7xl items-center gap-6 px-4">
        <Wordmark />
        <nav aria-label="Primary" className="flex items-center gap-1">
          {destinations.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg px-2 py-3 text-sm font-medium text-navy-900 hover:bg-mist-50"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <form role="search" className="relative">
            <label htmlFor="global-search" className="sr-only">
              Search Sea N Shore
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <input
              id="global-search"
              type="search"
              placeholder="Search"
              className="min-h-10 w-32 rounded-lg bg-mist-50 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted lg:w-44"
            />
          </form>
          <button
            type="button"
            aria-label="Notifications"
            className="grid min-h-10 min-w-10 place-items-center rounded-lg text-navy-900 hover:bg-mist-50"
          >
            <Bell aria-hidden="true" className="size-5" />
          </button>
          <Link
            href="/profile"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-navy-900 hover:bg-mist-50"
          >
            <UserRound aria-hidden="true" className="size-4" />
            Profile
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              className="grid min-h-10 min-w-10 place-items-center rounded-lg text-muted hover:bg-mist-50 hover:text-navy-900"
            >
              <LogOut aria-hidden="true" className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
