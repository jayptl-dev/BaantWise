import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { confirmsDeletion, deleteMyAccount, DELETE_WORD } from "../lib/account";

// The last part of Profile: delete your account for good, after typing DELETE.
export function DeleteAccountSection() {
  const navigate = useNavigate();
  const ids = { heading: useId(), word: useId() };
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function remove() {
    if (!confirmsDeletion(typed)) return;
    setBusy(true);
    setProblem(null);
    const result = await deleteMyAccount();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    navigate("/", { replace: true, state: { accountDeleted: true } });
  }

  return (
    <section className="section danger-zone" aria-labelledby={ids.heading}>
      <h2 id={ids.heading}>Delete my account</h2>
      {!open ? (
        <>
          <p className="muted">Erase your account and personal details from Baantwise for good.</p>
          <button type="button" className="button secondary danger" onClick={() => setOpen(true)}>
            Delete my account…
          </button>
        </>
      ) : (
        <>
          <p>This can't be undone. Here's what happens:</p>
          <ul className="delete-list">
            <li>Your sign-in, email address, picture and payment details are erased.</li>
            <li>Bills you forwarded by email, and recurring expenses you set up, are erased.</li>
            <li>
              Shared expenses stay in your groups under your current name, like a guest, so everyone else's balances
              stay right. To hide your name, change it above first.
            </li>
            <li>If you're a group's only admin, the longest-standing member becomes admin.</li>
            <li>A group where nobody else has an account is deleted.</li>
          </ul>
          <div className="field">
            <label htmlFor={ids.word}>
              Type <strong>{DELETE_WORD}</strong> to confirm
            </label>
            <input
              id={ids.word}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          {problem && (
            <p className="feedback error" role="alert">
              {problem}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="button danger" onClick={remove} disabled={busy || !confirmsDeletion(typed)}>
              {busy ? "Deleting…" : "Delete my account"}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setProblem(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
