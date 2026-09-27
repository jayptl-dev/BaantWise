import { useEffect, useRef, useState } from "react";
import { useReceiptLink } from "../lib/receipts";

// A small receipt, shown in the expense list next to expenses that have a photo.
export function ReceiptIcon() {
  return (
    <svg
      className="receipt-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Has a receipt photo"
    >
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}

// An expense's saved photo: loads a short-lived viewing link when shown, and a
// new one if the photo changes or the link has run out.
export function SavedReceipt({ path }: { path: string }) {
  const { link, refresh } = useReceiptLink(path);
  const [retried, setRetried] = useState(false);

  if (!link || link.status === "loading") {
    return (
      <p className="muted" role="status">
        Loading the photo…
      </p>
    );
  }
  if (link.status === "error") {
    return (
      <p className="receipt-problem">
        Couldn't load the receipt photo.{" "}
        <button type="button" className="text-button" onClick={refresh}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <ReceiptThumbnail
      src={link.url}
      onError={() => {
        // Most likely the 10-minute link ran out: get a new one, once.
        if (retried) return;
        setRetried(true);
        refresh();
      }}
    />
  );
}

// A tappable thumbnail. Tap it to see the photo full screen; tap again (or Close)
// to go back.
export function ReceiptThumbnail({ src, onError }: { src: string; onError?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="receipt-thumb" onClick={() => setOpen(true)}>
        <img src={src} alt="Receipt photo. Tap to see it full size." onError={onError} />
      </button>
      {open && <PhotoOverlay src={src} onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotoOverlay({ src, onClose }: { src: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      returnTo?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="photo-overlay"
      aria-label="Receipt photo"
      onCancel={(event) => {
        // Escape key
        event.preventDefault();
        onClose();
      }}
      // A tap anywhere closes it.
      onClick={onClose}
    >
      <img src={src} alt="Receipt photo" />
      <button type="button" className="photo-close" onClick={onClose} autoFocus>
        Close
      </button>
    </dialog>
  );
}
