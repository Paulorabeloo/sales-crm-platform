import { describe, expect, it } from "vitest";

import {
  firstName,
  formatPhoneBR,
  looksLikePhone,
  normalizePhone,
  phoneFromWhatsAppId,
} from "../src/lib/phone";

describe("normalizePhone", () => {
  it("adds +55 to 11-digit BR numbers (DDD + 9 digits)", () => {
    expect(normalizePhone("63999990001")).toBe("+5563999990001");
  });

  it("adds +55 to 10-digit BR numbers (DDD + 8 digits)", () => {
    expect(normalizePhone("6399990001")).toBe("+556399990001");
  });

  it("keeps an existing +55 prefix", () => {
    expect(normalizePhone("+5563999990001")).toBe("+5563999990001");
  });

  it("adds + to 13-digit numbers starting with 55", () => {
    expect(normalizePhone("5563999990001")).toBe("+5563999990001");
  });

  it("strips spaces, dashes, dots and parentheses", () => {
    expect(normalizePhone("+55 (63) 99999-0001")).toBe("+5563999990001");
    expect(normalizePhone("63 9.9999.0001")).toBe("+5563999990001");
  });

  it("accepts international numbers already in E.164", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });

  it("rejects garbage and empty input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });

  it("rejects numbers that cannot be E.164 (too long)", () => {
    expect(normalizePhone("12345678901234567890")).toBeNull();
  });

  it("matches the backend rule: leading zero makes it invalid", () => {
    // "+0..." fails the E.164 regex (first digit must be 1-9).
    expect(normalizePhone("+0123456789")).toBeNull();
  });
});

describe("looksLikePhone", () => {
  it("recognizes formatted BR numbers", () => {
    expect(looksLikePhone("+55 63 99999-0001")).toBe(true);
    expect(looksLikePhone("(63) 99999-0001")).toBe(false); // starts with "("
    expect(looksLikePhone("63 99999 0001")).toBe(true);
  });

  it("rejects names", () => {
    expect(looksLikePhone("Maria Silva")).toBe(false);
    expect(looksLikePhone("Turma 2026")).toBe(false);
    expect(looksLikePhone(null)).toBe(false);
  });

  it("rejects short digit runs", () => {
    expect(looksLikePhone("1234567")).toBe(false);
  });
});

describe("phoneFromWhatsAppId", () => {
  it("extracts the phone from an individual chat data-id", () => {
    expect(phoneFromWhatsAppId("false_5563999990001@c.us_3EB0ABC123")).toBe("+5563999990001");
    expect(phoneFromWhatsAppId("true_5563999990001@c.us_XYZ")).toBe("+5563999990001");
  });

  it("returns null for group ids", () => {
    expect(phoneFromWhatsAppId("false_120363041234567890@g.us_ABC")).toBeNull();
  });

  it("returns null for malformed ids", () => {
    expect(phoneFromWhatsAppId("")).toBeNull();
    expect(phoneFromWhatsAppId(null)).toBeNull();
    expect(phoneFromWhatsAppId("no-phone-here")).toBeNull();
  });
});

describe("formatPhoneBR", () => {
  it("formats 9-digit mobiles", () => {
    expect(formatPhoneBR("+5563999990001")).toBe("+55 (63) 99999-0001");
  });

  it("formats 8-digit landlines", () => {
    expect(formatPhoneBR("+556399990001")).toBe("+55 (63) 9999-0001");
  });

  it("passes non-BR numbers through unchanged", () => {
    expect(formatPhoneBR("+14155552671")).toBe("+14155552671");
    expect(formatPhoneBR(null)).toBe("");
  });
});

describe("firstName", () => {
  it("returns the first word of a name", () => {
    expect(firstName("Maria Silva Santos")).toBe("Maria");
  });

  it("returns empty for phones and empty input", () => {
    expect(firstName("+55 63 99999-0001")).toBe("");
    expect(firstName("")).toBe("");
    expect(firstName(null)).toBe("");
  });
});
