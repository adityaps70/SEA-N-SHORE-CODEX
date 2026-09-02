import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

export function PublicHeader() {
  return (
    <header className="border-b border-mist-100 bg-white">
      <div className="mx-auto flex min-h-18 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Wordmark />
        <nav
          aria-label="Public navigation"
          className="flex items-center gap-2 sm:gap-5"
        >
          <Link
            href="/auth/sign-in"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-mist-50"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-up"
            className="inline-flex min-h-10 items-center rounded-lg bg-ocean-700 px-3 text-sm font-semibold text-white hover:bg-navy-900 sm:px-4"
          >
            Join Sea N Shore
          </Link>
        </nav>
      </div>
    </header>
  );
}
