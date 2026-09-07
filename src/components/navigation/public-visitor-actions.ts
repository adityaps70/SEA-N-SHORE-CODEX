export function getPublicVisitorActions(isAuthenticated: boolean) {
  if (isAuthenticated) {
    return {
      primary: { label: 'My Profile', href: '/profile' },
      secondary: { label: 'Home', href: '/home' },
      heroPrimary: { label: 'Go to Home', href: '/home' },
      heroSecondary: { label: 'View My Profile', href: '/profile' },
    } as const
  }

  return {
    primary: { label: 'Join Sea N Shore', href: '/auth/sign-up' },
    secondary: { label: 'Sign in', href: '/auth/sign-in' },
    heroPrimary: { label: 'Create your professional profile', href: '/auth/sign-up' },
    heroSecondary: { label: 'Sign in', href: '/auth/sign-in' },
  } as const
}
