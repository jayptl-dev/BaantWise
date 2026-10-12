import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { countForwardedBills } from "../lib/forwarding";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";

// On the group page: "You have 2 forwarded bills to review". Only the person who
// forwarded them sees them (Row Level Security).
export function ForwardedBillsNotice({ groupId }: { groupId: string }) {
  const [count, setCount] = useState(0);
  const [version, setVersion] = useState(0);
  useRefreshOnReturn(useCallback(() => setVersion((v) => v + 1), []));

  useEffect(() => {
    let active = true;
    countForwardedBills(groupId).then((found) => {
      if (active) setCount(found);
    });
    return () => {
      active = false;
    };
  }, [groupId, version]);

  if (count === 0) return null;
  return (
    <p className="bills-notice" role="status">
      📧 You have {count === 1 ? "1 forwarded bill" : `${count} forwarded bills`} to review.{" "}
      <Link to={`/groups/${groupId}/bills`}>Review them</Link>
    </p>
  );
}
