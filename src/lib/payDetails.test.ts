import { describe, expect, it } from "vitest";
import { checkInterac, checkPayPal, payPalUrl } from "./payDetails";

describe("checkInterac", () => {
  it("is optional", () => {
    expect(checkInterac("")).toEqual({ value: null });
    expect(checkInterac("   ")).toEqual({ value: null });
  });

  it("accepts an email", () => {
    expect(checkInterac(" jay@example.com ")).toEqual({ value: "jay@example.com" });
    expect(checkInterac("jay.p+money@mail.example.ca")).toEqual({ value: "jay.p+money@mail.example.ca" });
  });

  it("accepts a 10-digit phone number, written any usual way", () => {
    for (const phone of [
      "4165550123",
      "416-555-0123",
      "(416) 555-0123",
      "416.555.0123",
      "+1 416 555 0123",
      "1-416-555-0123",
    ]) {
      expect(checkInterac(phone), phone).toEqual({ value: phone });
    }
  });

  it("refuses things that aren't an email or a phone number", () => {
    for (const text of [
      "jay@",
      "jay@example",
      "@example.com",
      "jay @example.com",
      "555-0123",
      "41655501234",
      "call me",
      "416-555-O123",
    ]) {
      expect(checkInterac(text).problem, text).toBeTruthy();
    }
  });

  it("refuses anything over 100 characters", () => {
    expect(checkInterac(`${"a".repeat(95)}@example.com`).problem).toBeTruthy();
  });
});

describe("checkPayPal", () => {
  it("is optional", () => {
    expect(checkPayPal("")).toEqual({ value: null });
  });

  it("accepts letters and numbers, up to 20", () => {
    expect(checkPayPal("JayP9")).toEqual({ value: "JayP9" });
    expect(checkPayPal("a".repeat(20))).toEqual({ value: "a".repeat(20) });
    expect(checkPayPal("a".repeat(21)).problem).toBeTruthy();
  });

  it("keeps just the name from a pasted link", () => {
    for (const link of [
      "https://paypal.me/JayP9",
      "https://www.paypal.me/JayP9/25",
      "paypal.me/JayP9?locale.x=en_CA",
      "https://www.paypal.com/paypalme/JayP9",
      "PayPal.Me/@JayP9",
      "@JayP9",
    ]) {
      expect(checkPayPal(link), link).toEqual({ value: "JayP9" });
    }
  });

  it("refuses anything else", () => {
    for (const text of ["jay p", "jay.p", "jay_p", "jayé", "https://paypal.me/", "https://example.com/JayP9"]) {
      expect(checkPayPal(text).problem, text).toBeTruthy();
    }
  });
});

describe("payPalUrl", () => {
  it("asks for the exact amount in Canadian dollars", () => {
    expect(payPalUrl("JayP9", 3000)).toBe("https://paypal.me/JayP9/30.00CAD");
    expect(payPalUrl("JayP9", 1205)).toBe("https://paypal.me/JayP9/12.05CAD");
    expect(payPalUrl("JayP9", 7)).toBe("https://paypal.me/JayP9/0.07CAD");
  });
});
