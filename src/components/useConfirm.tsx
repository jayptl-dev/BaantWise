import { useCallback, useEffect, useRef, useState } from "react";

type Question = {
  message: string;
  confirmLabel: string;
  danger: boolean;
  answer: (yes: boolean) => void;
};

// Asks "are you sure?" in a small pop-up box.
// Usage: `if (!(await ask("Remove Priya?", "Remove"))) return;` and render `{dialog}`.
export function useConfirm() {
  const [question, setQuestion] = useState<Question | null>(null);

  const ask = useCallback(
    (message: string, confirmLabel: string, danger = true) =>
      new Promise<boolean>((resolve) => {
        setQuestion({ message, confirmLabel, danger, answer: resolve });
      }),
    [],
  );

  function close(yes: boolean) {
    question?.answer(yes);
    setQuestion(null);
  }

  const dialog = question ? <ConfirmDialog question={question} onClose={close} /> : null;
  return { ask, dialog };
}

function ConfirmDialog({ question, onClose }: { question: Question; onClose: (yes: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-label="Please confirm"
      onCancel={(event) => {
        // Escape key: treat as "Cancel".
        event.preventDefault();
        onClose(false);
      }}
    >
      <p>{question.message}</p>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={() => onClose(false)}>
          Cancel
        </button>
        <button
          type="button"
          className={question.danger ? "button danger" : "button"}
          onClick={() => onClose(true)}
        >
          {question.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
