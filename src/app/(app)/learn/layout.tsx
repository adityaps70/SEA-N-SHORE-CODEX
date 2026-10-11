/**
 * Signed-in learning pages (My Learning, the course player, Learning Studio). The `lms` class gives
 * their headings the heading face and balanced line breaks (globals.css, learning round E).
 */
export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return <div className="lms">{children}</div>
}
