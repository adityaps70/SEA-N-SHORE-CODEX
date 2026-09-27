import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "primary", type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
          variant === "primary" && "bg-ocean-700 text-white hover:bg-navy-900 disabled:bg-ocean-700",
          variant === "secondary" &&
            "border border-navy-900 bg-white text-navy-900 hover:bg-mist-50 disabled:bg-white",
          variant === "quiet" && "text-navy-900 hover:bg-mist-100 disabled:bg-transparent",
          className,
        )}
        {...props}
      />
    );
  },
);
