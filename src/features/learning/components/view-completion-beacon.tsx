'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { completeLearningLesson } from '../learner-progress-actions'

type Props = {
  slug: string
  lessonId: string
  alreadyCompleted: boolean
}

export function ViewCompletionBeacon({ slug, lessonId, alreadyCompleted }: Props) {
  const router = useRouter()
  const sent = useRef(false)

  useEffect(() => {
    if (alreadyCompleted || sent.current) return
    sent.current = true
    void (async () => {
      const result = await completeLearningLesson(slug, lessonId)
      if (result.ok) router.refresh()
    })()
  }, [alreadyCompleted, lessonId, router, slug])

  return null
}
