import { useId, useLayoutEffect, useRef, type ReactNode } from "react";

type SheetProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

// A pop-up box with a title, for things like paying someone back.
// Escape, or a tap on the dimmed area outside the box, closes it.
export function Sheet({ title, onClose, children }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  // Open as a pop-up and give focus back to the button that opened it when it closes.
  // Focus starts on the title rather than the first box, so a phone doesn't open its
  // keyboard over the box straight away.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      returnTo?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape key
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dimmed area outside the box
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-body">
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
