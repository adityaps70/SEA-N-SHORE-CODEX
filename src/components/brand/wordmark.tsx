import Link from "next/link";
import { RouteLine } from "./route-line";

export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Sea N Shore home"
      className="inline-flex items-center gap-2 rounded-lg text-navy-950"
    >
      <RouteLine className="h-5 w-12" />
      <span className="font-semibold tracking-[-0.04em]">Sea N Shore</span>
    </Link>
  );
}
