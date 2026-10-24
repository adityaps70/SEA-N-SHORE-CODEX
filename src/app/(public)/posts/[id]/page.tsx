import { MainLandmark } from '@/components/layout/main-landmark'
import type { Metadata } from 'next'
// Round P3: prefetch on intent only (viewport prefetch of these links cost thousands of requests).
import Link from '@/components/navigation/intent-link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { LockKeyhole } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { getVerifiedUser } from '@/features/auth/queries'
import { PostCard } from '@/features/feed/components/post-card'
import { genericPostMetadata, postPath, publicPostMetadata } from '@/features/feed/post-seo'
import { getPostPage, isPostId } from '@/features/feed/queries'
import { authHrefWithReturn } from '@/lib/auth/return-path'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ photo?: string | string[] }>
}

/** One load per request, shared by the metadata and the page. */
const loadPostPage = cache(async (id: string) => {
  const viewer = await getVerifiedUser()
  return { viewer, page: await getPostPage(id, viewer) }
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const { page } = await loadPostPage(id)
  if (page.kind === 'missing') return genericPostMetadata('Post not found')
  // Only a post its author shows to anyone describes itself in link previews.
  if (page.kind !== 'members_only' && page.post.audience === 'anyone' && !page.post.group) return publicPostMetadata(page.post)
  return genericPostMetadata()
}

const primaryButton = cn(buttonClass({ variant: 'primary' }), 'min-h-11 rounded-full text-[15px]')
const secondaryButton = cn(buttonClass({ variant: 'secondary' }), 'min-h-11 rounded-full text-[15px]')

function JoinBanner({ returnPath }: { returnPath: string }) {
  return (
    <section aria-labelledby="post-join-heading" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-ocean-100 bg-white px-5 py-4 shadow-[var(--shadow-card)] max-md:mx-0">
      <h2 id="post-join-heading" className="text-[15px] font-semibold text-navy-950">Join Sea N Shore to like, comment and connect</h2>
      <div className="flex flex-wrap gap-2">
        <Link href={authHrefWithReturn('/auth/sign-up', returnPath)} className={primaryButton}>Sign up</Link>
        <Link href={authHrefWithReturn('/auth/sign-in', returnPath)} className={secondaryButton}>Sign in</Link>
      </div>
    </section>
  )
}

function MembersOnlyTeaser({ returnPath }: { returnPath: string }) {
  return (
    <section aria-labelledby="post-members-only-heading" className="rounded-[var(--radius-card)] border border-mist-100 bg-white px-6 py-12 text-center shadow-[var(--shadow-card)]">
      <LockKeyhole aria-hidden="true" className="mx-auto size-8 text-ocean-700" />
      <h1 id="post-members-only-heading" className="mt-3 text-xl font-semibold text-navy-950">This post is only visible to members</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">Sign in to Sea N Shore to see it. New here? Joining is free.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href={authHrefWithReturn('/auth/sign-in', returnPath)} className={primaryButton}>Sign in</Link>
        <Link href={authHrefWithReturn('/auth/sign-up', returnPath)} className={secondaryButton}>Sign up</Link>
      </div>
    </section>
  )
}

export default async function PostPage({ params, searchParams }: PageProps) {
  const { id } = await params
  if (!isPostId(id)) notFound()
  const { viewer, page } = await loadPostPage(id)
  if (page.kind === 'missing') notFound()
  const returnPath = postPath(id)

  if (page.kind === 'members_only') {
    return (
      <MainLandmark className="mx-auto w-full max-w-page-narrow px-4 py-6 sm:py-10">
        <MembersOnlyTeaser returnPath={returnPath} />
      </MainLandmark>
    )
  }

  if (page.kind === 'public' && !viewer) {
    return (
      <MainLandmark className="mx-auto w-full max-w-page-narrow px-4 py-6 sm:py-10">
        <h1 className="sr-only">Post by {page.post.organization?.name ?? page.post.author.fullName}</h1>
        <JoinBanner returnPath={returnPath} />
        <PostCard post={page.post} detail readOnly signedOut />
      </MainLandmark>
    )
  }

  // Signed in. A tag notification links here with ?photo=<media id>: that photo is scrolled into view.
  const photo = (await searchParams)?.photo
  const focusMediaId = typeof photo === 'string' && isPostId(photo) ? photo : null
  return (
    <MainLandmark className="mx-auto w-full max-w-page-wide px-4 py-4 md:py-6">
      <h1 className="sr-only">Post by {page.post.organization?.name ?? page.post.author.fullName}</h1>
      <MobilePageBar backHref="/home" title="Post" />
      {/* Phones: the post runs edge to edge under the page bar. */}
      <section className="mx-auto w-full max-w-page-narrow py-2 sm:py-5 max-md:-mx-4 max-md:w-auto max-md:py-0">
        <PostCard
          post={page.post}
          detail
          flushOnPhones
          focusPhoto={focusMediaId && viewer ? { mediaId: focusMediaId, profileId: viewer.id } : null}
        />
      </section>
    </MainLandmark>
  )
}
