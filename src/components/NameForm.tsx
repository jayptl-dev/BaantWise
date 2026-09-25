import { useId, useState, type FormEvent } from "react";

type NameFormProps = {
  label: string;
  hint?: string;
  initial?: string;
  max: number;
  submitLabel: string;
  emptyMessage: string;
  busy: boolean;
  autoFocus?: boolean;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
};

// A one-field form for a name: new group, guest, renaming. Checks the length
// before anything is sent, using the same limits as the database.
export function NameForm({
  label,
  hint,
  initial = "",
  max,
  submitLabel,
  emptyMessage,
  busy,
  autoFocus,
  onSubmit,
  onCancel,
}: NameFormProps) {
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = value.trim();
    const length = Array.from(name).length;
    if (length === 0) return setProblem(emptyMessage);
    if (length > max) return setProblem(`Keep it to ${max} characters or fewer.`);
    setProblem(null);
    onSubmit(name);
  }

  return (
    <form className="name-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor={inputId}>{label}</label>
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      <input
        id={inputId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={max}
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint="done"
        aria-describedby={hint ? hintId : undefined}
        aria-invalid={problem ? true : undefined}
      />
      {problem && (
        <p className="feedback error" role="alert">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button" disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
