import { redirect } from 'next/navigation'

/**
 * Mobile-number sign-in and SMS codes are retired (Round 15). The route stays so old links
 * and bookmarks land on email sign-in instead of a 404.
 */
export default function PhoneAuthPage() {
  redirect('/auth/sign-in')
}
