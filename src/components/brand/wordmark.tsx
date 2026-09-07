import Image from "next/image";
import Link from "next/link";

export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Sea N Shore home"
      className="inline-flex shrink-0 items-center rounded-lg"
    >
      <Image
        src="/brand/sea-and-shore-logo.webp"
        alt="Sea and Shore Global Shipping Community"
        width={360}
        height={320}
        priority
        className="h-[58px] w-auto object-contain sm:h-[64px]"
      />
    </Link>
  );
}
