import { describe, expect, it } from "vitest";
import sql from "../../supabase/migrations/20261013003000_sample_groups.sql?raw";
import { SAMPLE_PEOPLE } from "./sampleGroup";

describe("sample group", () => {
  it("offers exactly the people the database can make", () => {
    const list = sql.match(/v_names text\[\] := array\[([^\]]+)\]/)?.[1] ?? "";
    const names = [...list.matchAll(/'([^']+)'/g)].map((m: RegExpMatchArray) => m[1]);
    expect(names).toEqual(SAMPLE_PEOPLE.map((p) => p.name));
  });
});
