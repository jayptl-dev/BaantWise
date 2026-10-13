import { useState } from "react";
import { useNavigate } from "react-router";
import { createSampleGroup, SAMPLE_PEOPLE, type SamplePerson } from "../lib/sampleGroup";
import { Sheet } from "./Sheet";

// "Try a sample group": pick which housemate to be, then open the sample.
export function SampleGroupDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<SamplePerson | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(who: SamplePerson) {
    setBusy(who);
    setProblem(null);
    const result = await createSampleGroup(who);
    if (!result.ok) {
      setBusy(null);
      setProblem(result.message);
      return;
    }
    navigate(`/groups/${result.groupId}`);
  }

  return (
    <Sheet title="Who do you want to be?" onClose={onClose}>
      <p className="hint sample-intro">
        A sample house with two months of shared bills. Only you can see it, nothing in it is real, and you can delete
        it anytime.
      </p>
      <ul className="sample-people">
        {SAMPLE_PEOPLE.map((p) => (
          <li key={p.name}>
            <button type="button" className="sample-person" onClick={() => pick(p.name)} disabled={busy !== null}>
              <span className="expense-icon" aria-hidden="true">
                {p.emoji}
              </span>
              <span className="look-text">
                <span className="look-name">{busy === p.name ? `Setting up ${p.name}'s house…` : p.name}</span>
                <span className="look-note">{p.about}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {problem && (
        <p className="feedback error" role="alert">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy !== null}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}
