import { describe, expect, it } from "vitest";
import { confirmsDeletion } from "./account";

describe("confirmsDeletion", () => {
  it("needs the word DELETE (any case, spaces around are fine)", () => {
    expect(confirmsDeletion("DELETE")).toBe(true);
    expect(confirmsDeletion(" delete ")).toBe(true);
    expect(confirmsDeletion("delet")).toBe(false);
    expect(confirmsDeletion("")).toBe(false);
  });
});
