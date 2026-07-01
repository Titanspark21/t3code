import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  describeSchedule,
  isMissedFixedTimeRun,
  isSameSchedule,
  isValidTimeZone,
  nextScheduledRunAt,
  parseTimeOfDay,
} from "./Schedule.ts";

function iso(value: DateTime.DateTime | null): string | null {
  return value === null ? null : DateTime.formatIso(DateTime.toUtc(value));
}

describe("scheduled task schedule calculation", () => {
  it("parses 24-hour times", () => {
    expect(parseTimeOfDay("09:30")).toEqual({ hour: 9, minute: 30 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeOfDay("25:00")).toBeNull();
  });

  it("calculates interval schedules from the supplied instant", () => {
    expect(
      iso(
        nextScheduledRunAt(
          { type: "interval", everyMs: 5 * 60_000 },
          DateTime.makeUnsafe("2026-07-01T16:00:00.000Z"),
        ),
      ),
    ).toBe("2026-07-01T16:05:00.000Z");
  });

  it("uses the persisted IANA time zone instead of the server process zone", () => {
    const next = nextScheduledRunAt(
      {
        type: "fixed_time",
        timeOfDay: "09:00",
        timeZone: "America/Los_Angeles",
        weekdays: [1, 2, 3, 4, 5],
      },
      DateTime.makeUnsafe("2026-07-03T17:00:00.000Z"),
    );
    // Friday 10:00 PDT has already passed the 09:00 slot, so the next
    // weekday occurrence is Monday 09:00 PDT = 16:00 UTC.
    expect(iso(next)).toBe("2026-07-06T16:00:00.000Z");
  });

  it("keeps a same-day fixed-time occurrence when it is still in the future", () => {
    const next = nextScheduledRunAt(
      {
        type: "fixed_time",
        timeOfDay: "09:00",
        timeZone: "America/Los_Angeles",
        weekdays: [1, 2, 3, 4, 5],
      },
      DateTime.makeUnsafe("2026-07-03T15:00:00.000Z"),
    );
    expect(iso(next)).toBe("2026-07-03T16:00:00.000Z");
  });

  it("skips a nonexistent wall-clock minute during the DST spring-forward gap", () => {
    const next = nextScheduledRunAt(
      {
        type: "fixed_time",
        timeOfDay: "02:30",
        timeZone: "America/Los_Angeles",
      },
      DateTime.makeUnsafe("2026-03-08T08:00:00.000Z"),
    );
    // 02:30 does not exist in Los Angeles on 2026-03-08; the following
    // day is 02:30 PDT = 09:30 UTC.
    expect(iso(next)).toBe("2026-03-09T09:30:00.000Z");
  });

  it("chooses the first future occurrence of an ambiguous fall-back minute", () => {
    const next = nextScheduledRunAt(
      {
        type: "fixed_time",
        timeOfDay: "01:30",
        timeZone: "America/Los_Angeles",
      },
      DateTime.makeUnsafe("2026-11-01T07:00:00.000Z"),
    );
    expect(iso(next)).toBe("2026-11-01T08:30:00.000Z");
  });

  it("validates IANA time zones", () => {
    expect(isValidTimeZone("Australia/Adelaide")).toBe(true);
    expect(isValidTimeZone("Not/A_Real_Time_Zone")).toBe(false);
  });

  it("catches up recent fixed-time runs but skips stale missed slots", () => {
    const fixedTime = {
      type: "fixed_time",
      timeOfDay: "09:00",
      timeZone: "Australia/Adelaide",
    } as const;
    const dueAt = DateTime.makeUnsafe("2026-07-01T09:00:00.000Z");
    const withinWindow = DateTime.makeUnsafe("2026-07-02T08:59:59.000Z");
    const pastWindow = DateTime.makeUnsafe("2026-07-02T10:00:00.000Z");
    expect(isMissedFixedTimeRun(fixedTime, dueAt, withinWindow)).toBe(false);
    expect(isMissedFixedTimeRun(fixedTime, dueAt, pastWindow)).toBe(true);
    // Interval schedules always catch up once after restart.
    expect(isMissedFixedTimeRun({ type: "interval", everyMs: 60_000 }, dueAt, pastWindow)).toBe(
      false,
    );
  });

  it("compares schedules structurally, including their time zone", () => {
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);

    const base = {
      type: "fixed_time",
      timeOfDay: "09:00",
      timeZone: "Australia/Adelaide",
    } as const;
    expect(isSameSchedule({ ...base, weekdays: [5, 1] }, { ...base, weekdays: [1, 5, 5] })).toBe(
      true,
    );
    expect(isSameSchedule(base, { ...base, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe(true);
    expect(isSameSchedule({ ...base, weekdays: [] }, base)).toBe(true);
    expect(isSameSchedule({ ...base, weekdays: [1, 2] }, { ...base, weekdays: [1, 3] })).toBe(
      false,
    );
    expect(isSameSchedule(base, { ...base, timeOfDay: "09:30" })).toBe(false);
    expect(isSameSchedule(base, { ...base, timeZone: "Australia/Darwin" })).toBe(false);
    expect(isSameSchedule({ type: "interval", everyMs: 60_000 }, base)).toBe(false);
  });

  it("describes fixed schedules with their persisted zone", () => {
    expect(
      describeSchedule({
        type: "fixed_time",
        timeOfDay: "07:15",
        timeZone: "Australia/Adelaide",
        weekdays: [1, 2, 3, 4, 5],
      }),
    ).toBe("At 07:15 every weekday (Australia/Adelaide)");
  });
});
