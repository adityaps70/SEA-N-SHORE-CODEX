import { notFound } from 'next/navigation'
import { getPostById } from '@/features/feed/queries'
import { PostCard } from '@/features/feed/components/post-card'

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const post = await getPostById(id)
  if (!post) notFound()

  return (
    <section className="mx-auto w-full max-w-3xl py-2 sm:py-5">
      <PostCard post={post} detail />
    </section>
  )
}
