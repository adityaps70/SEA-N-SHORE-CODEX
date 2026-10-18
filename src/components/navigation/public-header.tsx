import Link from '@/components/navigation/intent-link'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'
import { Wordmark } from "@/components/brand/wordmark";
import { getPublicVisitorActions } from "@/components/navigation/public-visitor-actions";

/**
 * Header for signed-out visitors on public and marketing pages: the wordmark, Sign in and Join.
 * Round H (H6): signed-in members get the full app header (MemberChrome) instead, so this
 * header no longer has a cut-down Home / My Profile variant.
 */
export function PublicHeader() {
  const actions = getPublicVisitorActions(false);

  return (
    <header className="border-b border-mist-100 bg-white">
      <div className="mx-auto flex min-h-18 w-full max-w-page-wide items-center justify-between gap-4 px-4 sm:px-6">
        <Wordmark compact />
        <nav
          aria-label="Public navigation"
          className="flex items-center gap-2 sm:gap-5"
        >
          <Link
            href={actions.secondary.href}
            className="rounded-lg border border-mist-200 bg-white px-3 py-2 text-sm font-semibold text-navy-900 transition-colors hover:border-ocean-300 hover:bg-mist-50"
          >
            {actions.secondary.label}
          </Link>
          <Link
            href={actions.primary.href}
            className={cn(buttonClass({ variant: 'primary', size: 'sm' }), 'rounded-lg px-3 sm:px-4')}
          >
            {actions.primary.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}
