import { cn } from "@/lib/cn";

export function RouteLine({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-6 w-16 text-teal-500", className)}
      viewBox="0 0 64 24"
      fill="none"
    >
      <path
        d="M3 17C15 17 15 6 29 6c13 0 11 12 25 12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="3" cy="17" r="3" fill="currentColor" />
      <circle cx="54" cy="18" r="3" fill="currentColor" />
    </svg>
  );
}
