import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { getPublicVisitorActions } from "@/components/navigation/public-visitor-actions";
import { getVerifiedUser } from "@/features/auth/queries";

export async function PublicHeader() {
  const viewer = await getVerifiedUser();
  const actions = getPublicVisitorActions(Boolean(viewer));

  return (
    <header className="border-b border-mist-100 bg-white">
      <div className="mx-auto flex min-h-18 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Wordmark compact />
        <nav
          aria-label="Public navigation"
          className="flex items-center gap-2 sm:gap-5"
        >
          <Link
            href={actions.secondary.href}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-mist-50"
          >
            {actions.secondary.label}
          </Link>
          <Link
            href={actions.primary.href}
            className="inline-flex min-h-10 items-center rounded-lg bg-ocean-700 px-3 text-sm font-semibold text-white hover:bg-navy-900 sm:px-4"
          >
            {actions.primary.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}
