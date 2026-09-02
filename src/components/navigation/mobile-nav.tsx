import Link from "next/link";

const destinations = [
  { href: "/home", label: "Home" },
  { href: "/jobs", label: "Jobs" },
  { href: "/community", label: "Community" },
  { href: "/learn", label: "Learn" },
  { href: "/events", label: "Events" },
  { href: "/profile", label: "Profile" },
] as const;

export function MobileNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-mist-100 bg-white/95 md:hidden"
    >
      {destinations.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="grid min-h-16 place-items-center px-1 text-center text-xs font-medium text-navy-900"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
