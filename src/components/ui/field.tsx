import { cn } from "@/lib/cn";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export function Field({
  label,
  error,
  hint,
  id,
  className,
  ...props
}: FieldProps) {
  const inputId = id ?? props.name;
  const descriptionId = inputId ? `${inputId}-description` : undefined;

  return (
    <label
      htmlFor={inputId}
      className="grid gap-2 text-sm font-medium text-navy-900"
    >
      {label}
      <input
        id={inputId}
        aria-label={props["aria-label"] ?? label}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? descriptionId : undefined}
        className={cn(
          "min-h-12 rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm placeholder:text-muted focus:border-ocean-700",
          className,
        )}
        {...props}
      />
      {(error || hint) && (
        <span
          id={descriptionId}
          className={error ? "text-red-700" : "text-muted"}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
