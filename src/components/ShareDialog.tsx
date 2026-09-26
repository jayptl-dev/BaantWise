import { useId, useLayoutEffect, useRef, useState } from "react";
import { emailUrl, inviteMessage, isPhone, smsUrl, whatsAppUrl } from "../lib/share";

type ShareDialogProps = {
  groupName: string;
  link: string;
  onClose: () => void;
};

// Our own share pop-up, used on computers (or if the phone's share menu fails):
// WhatsApp, Messages (phones only), Email and Copy link, plus the link itself.
export function ShareDialog({ groupName, link, onClose }: ShareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstOptionRef = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const titleId = useId();
  const linkId = useId();
  const message = inviteMessage(groupName, link);

  // Open as a pop-up, move focus into it, and give focus back to the button
  // that opened it when it closes.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    firstOptionRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      returnTo?.focus();
    };
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="share-dialog"
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
        <h2 id={titleId}>Share invite link</h2>
        <div className="share-options">
          <a
            ref={firstOptionRef}
            className="button secondary"
            href={whatsAppUrl(message)}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
          {isPhone() && (
            <a className="button secondary" href={smsUrl(message)}>
              Messages
            </a>
          )}
          <a className="button secondary" href={emailUrl(`Join "${groupName}" on Baantwise`, message)}>
            Email
          </a>
          <button type="button" className="button secondary" onClick={copyLink} aria-live="polite">
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>

        <label htmlFor={linkId}>Or copy the link yourself</label>
        <input id={linkId} readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
        {copyFailed && (
          <p className="feedback error" role="alert">
            Couldn't copy automatically. Select the link above and copy it.
          </p>
        )}

        <button type="button" className="button close-button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
