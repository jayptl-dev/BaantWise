import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase } from "../lib/supabase";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";

// On the group page: "You have 2 bills to fill in", from recurring expenses whose amount
// changes each time. Only the person who set them up sees them (Row Level Security).
export function BillsNotice({ groupId }: { groupId: string }) {
  const [count, setCount] = useState(0);
  const [version, setVersion] = useState(0);
  useRefreshOnReturn(useCallback(() => setVersion((v) => v + 1), []));

  useEffect(() => {
    let active = true;
    supabase
      .from("recurring_bills")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .is("closed_at", null)
      .then(({ count: found, error }) => {
        if (active && !error) setCount(found ?? 0);
      });
    return () => {
      active = false;
    };
  }, [groupId, version]);

  if (count === 0) return null;
  return (
    <p className="bills-notice" role="status">
      🧾 You have {count === 1 ? "1 bill" : `${count} bills`} to fill in.{" "}
      <Link to={`/groups/${groupId}/recurring`}>Enter the amounts</Link>
    </p>
  );
}
