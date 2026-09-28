import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { CATEGORIES, categoryFor, type CategoryKey } from "../lib/categories";

const GAP = 6; // pixels between the button and the picker on wider screens

type CategoryButtonProps = {
  value: CategoryKey;
  onPick: (key: CategoryKey) => void;
};

// A square button showing the category's emoji. Tapping it opens the picker.
export function CategoryButton({ value, onPick }: CategoryButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { emoji, label } = categoryFor(value);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="category-button"
        aria-label={`Category: ${label}. Change category`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Change category"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">{emoji}</span>
      </button>
      {open && (
        <CategoryPicker
          anchor={buttonRef}
          value={value}
          onPick={(key) => {
            onPick(key);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type CategoryPickerProps = {
  anchor: RefObject<HTMLButtonElement | null>;
  value: CategoryKey;
  onPick: (key: CategoryKey) => void;
  onClose: () => void;
};

// The 10 categories, with the current one highlighted. On a phone it comes up from the
// bottom of the screen; on a wider screen it's a small box lined up with the button
// (see index.css). Escape, or a tap outside it, closes it.
function CategoryPicker({ anchor, value, onPick, onClose }: CategoryPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Open it, start on the current category, and give focus back to the button when it closes.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const button = anchor.current;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[aria-current]")?.focus();

    // Wider screens: just under the button with their right edges lined up, or just above
    // it if there's no room below. Kept in place if the page scrolls or resizes.
    function place() {
      if (!dialog || !button) return;
      const at = button.getBoundingClientRect();
      const height = dialog.getBoundingClientRect().height;
      const below = at.bottom + GAP;
      const above = at.top - GAP - height;
      const top = below + height > window.innerHeight && above >= 0 ? above : below;
      dialog.style.setProperty("--picker-top", `${top}px`);
      dialog.style.setProperty("--picker-right", `${document.documentElement.clientWidth - at.right}px`);
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (dialog.open) dialog.close();
      button?.focus();
    };
  }, [anchor]);

  return (
    <dialog
      ref={dialogRef}
      className="category-picker"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape key
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click outside the box (the padding is on .dialog-body, so this is the only way
        // a click lands on the dialog itself)
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-body">
        <h2 id={titleId}>Category</h2>
        <div className="category-options">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              className="category-option"
              aria-current={c.key === value ? "true" : undefined}
              onClick={() => onPick(c.key)}
            >
              <span aria-hidden="true">{c.emoji}</span> {c.label}
            </button>
          ))}
        </div>
        <button type="button" className="button secondary close-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
