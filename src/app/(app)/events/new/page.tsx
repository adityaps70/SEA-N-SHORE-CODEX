import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Create an event' }

export default function NewEventPage() {
  redirect('/events/create')
}
