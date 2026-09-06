import { describe, expect, it } from "vite-plus/test";

import { isClaudePeakTime } from "./claudePeakTime.js";

describe("isClaudePeakTime", () => {
  it("handles Pacific daylight time", () => {
    expect(isClaudePeakTime(Date.parse("2026-09-07T12:00:00Z"))).toBe(true);
    expect(isClaudePeakTime(Date.parse("2026-09-07T17:59:59Z"))).toBe(true);
    expect(isClaudePeakTime(Date.parse("2026-09-07T18:00:00Z"))).toBe(false);
  });

  it("handles Pacific standard time and weekends", () => {
    expect(isClaudePeakTime(Date.parse("2026-01-05T13:00:00Z"))).toBe(true);
    expect(isClaudePeakTime(Date.parse("2026-01-05T19:00:00Z"))).toBe(false);
    expect(isClaudePeakTime(Date.parse("2026-01-10T15:00:00Z"))).toBe(false);
  });
});
