import { useEffect, useId, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { normalizeUsername, USERNAME_HINT } from "../lib/friends";
import { supabase } from "../lib/supabase";
import type { Feedback } from "../lib/useDbAction";
import { FeedbackLine } from "./Status";

// Profile → "Username": optional. People who know it can add you as a friend.
export function UsernameSection() {
  const { user } = useAuth();
  const id = useId();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setSaved(data?.username ?? null);
        setText(data?.username ?? "");
      });
  }, [user]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    const wanted = text.trim() === "" ? null : normalizeUsername(text);
    if (text.trim() !== "" && !wanted) {
      setFeedback({ text: `That username won't work. ${USERNAME_HINT}`, isError: true });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const { error } = await supabase.from("profiles").update({ username: wanted }).eq("id", user.id);
    setBusy(false);
    if (error) {
      const taken = error.code === "23505";
      setFeedback({ text: taken ? "Someone already has that username. Try another." : "Couldn't save it. Please try again.", isError: true });
      return;
    }
    setSaved(wanted);
    setText(wanted ?? "");
    setFeedback({ text: wanted ? `Saved. Friends can now add you as @${wanted}.` : "Username removed.", isError: false });
  }

  return (
    <section className="section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Username</h2>
      <p className="hint">Optional. Friends who know it can add you on the Friends page. {USERNAME_HINT}</p>
      <form className="field" onSubmit={save} noValidate>
        <label htmlFor={id} className="visually-hidden">
          Username
        </label>
        <div className="description-row">
          <span className="prefixed-input">
            <span aria-hidden="true">@</span>
            <input
              id={id}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="your.name"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={21}
            />
          </span>
          <button type="submit" className="button friend-add" disabled={busy || (text.trim() || null) === saved}>
            Save
          </button>
        </div>
        <FeedbackLine feedback={feedback} />
      </form>
    </section>
  );
}
