import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_PEOPLE } from "./sampleGroup";

describe("sample group", () => {
  it("offers exactly the people the database can make", () => {
    const sql = readFileSync("supabase/migrations/20261013003000_sample_groups.sql", "utf8");
    const names = sql.match(/v_names text\[\] := array\[([^\]]+)\]/)?.[1].match(/'([^']+)'/g)?.map((n) => n.slice(1, -1));
    expect(names).toEqual(SAMPLE_PEOPLE.map((p) => p.name));
  });
});
