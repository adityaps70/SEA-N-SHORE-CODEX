import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { getPostById } from '@/features/feed/queries'
import { PostCard } from '@/features/feed/components/post-card'

export const metadata: Metadata = { title: 'Post' }

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const post = await getPostById(id)
  if (!post) notFound()

  return (
    <>
      <MobilePageBar backHref="/home" title="Post" />
      {/* Phones: the post runs edge to edge under the page bar. */}
      <section className="mx-auto w-full max-w-3xl py-2 sm:py-5 max-md:-mx-4 max-md:w-auto max-md:py-0">
        <PostCard post={post} detail flushOnPhones />
      </section>
    </>
  )
}
