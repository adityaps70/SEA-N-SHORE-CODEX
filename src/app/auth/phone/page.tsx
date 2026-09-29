import { redirect } from 'next/navigation'

/**
 * Mobile-number sign-in is no longer offered in the UI. The route stays so old links
 * and bookmarks land on email sign-in instead of a 404; the phone auth form and its
 * server actions remain in the codebase, unused by this page.
 */
export default function PhoneAuthPage() {
  redirect('/auth/sign-in')
}
