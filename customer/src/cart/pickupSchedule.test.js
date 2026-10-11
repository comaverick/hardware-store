import { pickupBounds, pickupError, pickupToIso } from "./pickupSchedule";

test("Philippine pickup dates convert to an unambiguous instant regardless of the browser timezone", () => {
  expect(pickupToIso("2026-10-12", "09:30")).toBe("2026-10-12T01:30:00.000Z");
  expect(pickupToIso("2026-10-12", "00:15")).toBe("2026-10-11T16:15:00.000Z");
  expect(pickupToIso("2028-02-29", "17:00")).toBe("2028-02-29T09:00:00.000Z");
});

test("impossible dates and malformed times cannot be silently rolled over", () => {
  for (const [date, time] of [["2026-02-30", "09:00"], ["2026-02-29", "09:00"], ["2026-13-01", "09:00"], ["2026-10-12", "24:00"], ["2026-10-12", "12:60"], ["2026-10-12", "9:00"], ["", "09:00"]]) {
    expect(pickupToIso(date, time)).toBeNull();
  }
});

test("future slots and the rolling seven-day cutoff are validated in Philippine time", () => {
  const now = Date.parse("2026-10-11T01:00:00.000Z");
  expect(pickupError("2026-10-11", "09:01", now)).toBe("");
  expect(pickupError("2026-10-18", "09:00", now)).toBe("");
  expect(pickupError("2026-10-11", "09:00", now)).toMatch(/future/);
  expect(pickupError("2026-10-18", "09:01", now)).toMatch(/seven days/);
  expect(pickupError("", "09:01", now)).toMatch(/date and time/);
});

test("date picker bounds move to the next Philippine day at midnight", () => {
  const now = Date.parse("2026-10-11T15:59:59.000Z");
  expect(pickupBounds(now)).toEqual({ min: { date: "2026-10-12", time: "00:00" }, max: { date: "2026-10-18", time: "23:59" } });
});
