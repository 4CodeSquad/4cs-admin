import { describe, expect, it } from "vitest";
import { parseAmount, formatMoney } from "@/lib/money";
import { nthOccurrence, addMonths, today, isValidDate } from "@/lib/dates";

describe("parseAmount", () => {
  it.each([
    ["1234", 123400],
    ["1234.5", 123450],
    ["1,234.50", 123450],
    ["1.234,50", 123450],
    ["€ 99,99", 9999],
    ["120 000", 12000000],
    ["0.01", 1],
  ])("%s → %d", (input, minor) => expect(parseAmount(input)).toBe(minor));
  it.each(["", "abc", "1.2.3,4,5x", "12.345"])("rejects or reads safely: %s", (input) => {
    const r = parseAmount(input);
    if (input === "12.345") expect(r).toBe(1234500); // thousands separator, not 12.345
    else expect(r).toBeNull();
  });
  it("formats lek without decimals", () => expect(formatMoney(12000000, "ALL")).toMatch(/120,000/));
});

describe("dates", () => {
  it("clamps month ends and returns to the 31st", () => {
    expect(nthOccurrence("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(nthOccurrence("2026-01-31", "monthly", 2)).toBe("2026-03-31");
    expect(nthOccurrence("2028-01-31", "monthly", 1)).toBe("2028-02-29");
    expect(nthOccurrence("2026-11-30", "quarterly", 1)).toBe("2027-02-28");
    expect(nthOccurrence("2026-01-05", "weekly", 3)).toBe("2026-01-26");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("uses the Tirana calendar day, not UTC", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Tirana (UTC+1 in winter).
    expect(today(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
  it("validates calendar dates", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("26-2-1")).toBe(false);
  });
});
