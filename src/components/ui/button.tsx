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
          "inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          variant === "primary" && "bg-ocean-700 text-white hover:bg-navy-900",
          variant === "secondary" &&
            "border border-navy-900 bg-white text-navy-900 hover:bg-mist-50",
          variant === "quiet" && "text-navy-900 hover:bg-mist-100",
          className,
        )}
        {...props}
      />
    );
  },
);
