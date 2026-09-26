import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { FeedbackLine, LoadError, Loading } from "../components/Status";
import { useAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";
import { PERSON_NAME_MAX } from "../lib/format";
import { checkInterac, checkPayPal, INTERAC_MAX } from "../lib/payDetails";
import { supabase } from "../lib/supabase";
import { mustChange, useDbAction } from "../lib/useDbAction";
import { useGoBack } from "../lib/useGoBack";

type ProfileFields = { display_name: string; interac_contact: string | null; paypal_me: string | null };

type ProfileState =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; profile: ProfileFields };

// Your own profile row. Row Level Security lets you read and change only your own.
async function fetchProfile(userId: string): Promise<ProfileState> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, interac_contact, paypal_me")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { status: "error", message: friendlyError(error) };
  if (!data) return { status: "error", message: "Couldn't find your profile. Please sign out and sign in again." };
  return { status: "ready", profile: data };
}

// "/profile": your name and your optional payment details. Opened from your photo
// in the header.
export default function Profile() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchProfile(userId).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [userId, version]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setVersion((v) => v + 1);
  }, []);

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <LoadError message={state.message} onRetry={retry} />;
  return <ProfileForm userId={userId} profile={state.profile} />;
}

type Problems = { name?: string; interac?: string; paypal?: string };

function ProfileForm({ userId, profile }: { userId: string; profile: ProfileFields }) {
  const goBack = useGoBack();
  const { busy, feedback, setFeedback, run } = useDbAction();
  const ids = { name: useId(), interac: useId(), paypal: useId(), note: useId() };
  const [name, setName] = useState(profile.display_name);
  const [interac, setInterac] = useState(profile.interac_contact ?? "");
  const [paypal, setPaypal] = useState(profile.paypal_me ?? "");
  const [problems, setProblems] = useState<Problems>({});

  // A pasted paypal.me link becomes just the name when you leave the box.
  function tidyPaypal() {
    const checked = checkPayPal(paypal);
    if (checked.problem === undefined) setPaypal(checked.value ?? "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    const newName = name.trim();
    const nameLength = Array.from(newName).length;
    const interacChecked = checkInterac(interac);
    const paypalChecked = checkPayPal(paypal);

    const found: Problems = {};
    if (nameLength === 0) found.name = "Type your name.";
    else if (nameLength > PERSON_NAME_MAX) found.name = `Keep it to ${PERSON_NAME_MAX} characters or fewer.`;
    if (interacChecked.problem) found.interac = interacChecked.problem;
    if (paypalChecked.problem) found.paypal = paypalChecked.problem;
    setProblems(found);
    const first = found.name ? ids.name : found.interac ? ids.interac : found.paypal ? ids.paypal : null;
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }

    const interacValue = interacChecked.value ?? null;
    const paypalValue = paypalChecked.value ?? null;
    const saved = await run(async () => {
      const profileSaved = await mustChange(
        supabase
          .from("profiles")
          .update({ display_name: newName, interac_contact: interacValue, paypal_me: paypalValue }, { count: "exact" })
          .eq("id", userId),
        "Couldn't save your profile. Please sign out and sign in again.",
      );
      if (profileSaved.error) return profileSaved;
      // Your name in every group you're in (only the ones where it's different).
      return supabase
        .from("group_members")
        .update({ display_name: newName })
        .eq("user_id", userId)
        .is("removed_at", null)
        .neq("display_name", newName);
    }, "Saved.");
    if (saved) {
      setName(newName);
      setInterac(interacValue ?? "");
      setPaypal(paypalValue ?? "");
    }
  }

  return (
    <>
      <button type="button" className="back-link" onClick={() => goBack("/")}>
        ← Back
      </button>
      <h1 className="page-title">Your profile</h1>

      <form className="expense-form profile-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={ids.name}>Your name</label>
          <p className="hint">Saving also changes your name in all your groups.</p>
          <input
            id={ids.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={PERSON_NAME_MAX}
            autoComplete="name"
            {...problemProps(`${ids.name}-problem`, problems.name)}
          />
          <FieldError id={`${ids.name}-problem`} text={problems.name} />
        </div>

        <fieldset aria-describedby={ids.note}>
          <legend>Getting paid back</legend>
          <p id={ids.note} className="hint">
            Only people in your groups can see these. Both are optional.
          </p>

          <div className="field">
            <label htmlFor={ids.interac}>Interac e-Transfer email or phone</label>
            <input
              id={ids.interac}
              value={interac}
              onChange={(event) => setInterac(event.target.value)}
              maxLength={INTERAC_MAX}
              placeholder="name@example.com or 416-555-0123"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              {...problemProps(`${ids.interac}-problem`, problems.interac)}
            />
            <FieldError id={`${ids.interac}-problem`} text={problems.interac} />
          </div>

          <div className="field">
            <label htmlFor={ids.paypal}>PayPal.Me username</label>
            <span className="prefixed-input">
              <span aria-hidden="true">paypal.me/</span>
              <input
                id={ids.paypal}
                value={paypal}
                onChange={(event) => setPaypal(event.target.value)}
                onBlur={tidyPaypal}
                placeholder="YourName"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                {...problemProps(`${ids.paypal}-problem`, problems.paypal)}
              />
            </span>
            <p className="hint">Letters and numbers, up to 20. You can paste your paypal.me link.</p>
            <FieldError id={`${ids.paypal}-problem`} text={problems.paypal} />
          </div>
        </fieldset>

        <FeedbackLine feedback={feedback} />
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </>
  );
}

// Marks a box as having a problem and links it to the message under it.
function problemProps(errorId: string, problem: string | undefined) {
  return problem ? { "aria-invalid": true, "aria-describedby": errorId } : {};
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="field-error">
      {text}
    </p>
  );
}
