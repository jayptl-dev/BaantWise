import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { Feedback } from "../lib/useDbAction";

export function Loading() {
  return (
    <p className="loading" role="status">
      Loading…
    </p>
  );
}

// Used before we know whether someone is signed in.
export function FullPageLoading() {
  return (
    <main className="landing">
      <Loading />
    </main>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state">
      <p role="alert">{message}</p>
      <button type="button" className="button secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function GroupMissing() {
  return (
    <div className="state">
      <p>We couldn't open this group. It may have been deleted, or you may no longer be a member.</p>
      <Link to="/" className="button secondary">
        Back to your groups
      </Link>
    </div>
  );
}

// Shown when a group you had open was deleted, or you left or were removed.
export function GroupGone() {
  return (
    <div className="state">
      <p role="alert">This group isn't available any more.</p>
      <Link to="/" className="button secondary">
        Go to your groups
      </Link>
    </div>
  );
}

// An expense link that doesn't open: mistyped, deleted, or private to other people.
export function ExpenseMissing({ groupId, groupName }: { groupId: string; groupName: string }) {
  return (
    <div className="state">
      <p>We couldn't open this expense. It may have been deleted, or it may be private to other people.</p>
      <Link to={`/groups/${groupId}`} className="button secondary">
        Back to {groupName}
      </Link>
    </div>
  );
}

// Shown when an expense you had open was deleted.
export function ExpenseDeleted({ groupId, groupName }: { groupId: string; groupName: string }) {
  return (
    <div className="state">
      <p role="alert">This expense was deleted.</p>
      <Link to={`/groups/${groupId}`} className="button secondary">
        Back to {groupName}
      </Link>
    </div>
  );
}

// One line of feedback. Scrolls itself into view so it isn't missed on a phone.
export function FeedbackLine({ feedback }: { feedback: Feedback }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (feedback) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [feedback]);

  if (!feedback) return null;
  return (
    <p
      ref={ref}
      className={feedback.isError ? "feedback error" : "feedback"}
      role={feedback.isError ? "alert" : "status"}
    >
      {feedback.text}
    </p>
  );
}
