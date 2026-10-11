/**
 * The course catalogue and course pages are public (signed-out visitors and search engines can
 * read them). They keep the same page width and spacing as the signed-in app shell.
 */
export default function PublicLearnLayout({ children }: { children: React.ReactNode }) {
  return <div className="lms mx-auto w-full max-w-7xl px-4 py-4 md:py-6">{children}</div>
}
