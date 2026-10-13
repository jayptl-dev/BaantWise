import { useId, useLayoutEffect, useRef, useState } from "react";
import { TOUR_STEPS } from "../lib/tour";

// The welcome tour pop-up: one card per feature, with Back / Next and Skip.
// Escape, a tap outside, Skip or the last button all close it.
export function WelcomeTour({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [index, setIndex] = useState(0);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      returnTo?.focus();
    };
  }, []);

  // Each new card starts at its title, so screen readers read it from the top.
  useLayoutEffect(() => {
    titleRef.current?.focus();
  }, [index]);

  return (
    <dialog
      ref={dialogRef}
      className="sheet tour"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-body">
        <div className="tour-top">
          <span className="tour-count">
            {index + 1} of {TOUR_STEPS.length}
          </span>
          {!last && (
            <button type="button" className="text-button" onClick={onClose}>
              Skip
            </button>
          )}
        </div>
        <div className="tour-emoji" aria-hidden="true">
          {step.emoji}
        </div>
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {step.title}
        </h2>
        <p className="tour-text">{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.title} className={i === index ? "on" : undefined} />
          ))}
        </div>
        <div className="form-actions">
          {index > 0 && (
            <button type="button" className="button secondary" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          <button type="button" className="button" onClick={() => (last ? onClose() : setIndex(index + 1))}>
            {last ? "Let's go" : "Next"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
