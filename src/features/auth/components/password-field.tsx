"use client";

import { useId, useState } from "react";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/cn";

type PasswordFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  error?: string;
  hint?: string;
  /** Rules shown under the field and ticked off as the person types (sign-up). Replaces the hint. */
  requirements?: ReadonlyArray<{ id: string; label: string; met: boolean }>;
};

/**
 * The auth password input. Same look as <Field>; on phones it also has a Show/Hide
 * toggle inside the field (desktop keeps today's plain field).
 */
export function PasswordField({ label, error, hint, requirements, id, className, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const fallbackId = useId();
  const inputId = id ?? props.name ?? fallbackId;
  const descriptionId = `${inputId}-description`;

  return (
    <div className="grid gap-2 text-sm font-medium text-navy-900">
      <label htmlFor={inputId}>{label}</label>
      <div className="relative">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          aria-label={props["aria-label"] ?? label}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint || requirements ? descriptionId : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            "min-h-12 w-full rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm placeholder:text-muted focus:border-ocean-700 max-md:pr-20",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-controls={inputId}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-1 my-auto inline-flex h-11 min-w-14 cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-semibold text-ocean-700 hover:text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ocean-500 md:hidden"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {requirements && !error ? (
        <ul id={descriptionId} className="grid gap-1 text-muted">
          {requirements.map((rule) => (
            <li key={rule.id} className={cn("flex items-center gap-2", rule.met && "text-ocean-700")}>
              {rule.met ? <Check aria-hidden="true" className="size-4 shrink-0" /> : <Circle aria-hidden="true" className="size-4 shrink-0" />}
              <span>
                <span className="sr-only">{rule.met ? "Done: " : "Needed: "}</span>
                {rule.label}
              </span>
            </li>
          ))}
        </ul>
      ) : (error || hint) && (
        <span id={descriptionId} className={error ? "text-red-700" : "text-muted"}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
