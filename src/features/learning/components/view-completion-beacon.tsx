'use client'

import { useEffect, useRef } from 'react'
import { completeLearningLesson } from '../learner-progress-actions'

type Props = {
  slug: string
  lessonId: string
  alreadyCompleted: boolean
}

export function ViewCompletionBeacon({ slug, lessonId, alreadyCompleted }: Props) {
  const sent = useRef(false)

  // completeLearningLesson revalidates the lesson page, which re-renders it with the progress.
  useEffect(() => {
    if (alreadyCompleted || sent.current) return
    sent.current = true
    void completeLearningLesson(slug, lessonId).catch(() => undefined)
  }, [alreadyCompleted, lessonId, slug])

  return null
}
