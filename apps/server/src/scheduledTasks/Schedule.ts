import type { ScheduledTaskSchedule } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    // Force validation now; some runtimes defer invalid-zone errors until format().
    formatter.format(0);
    formatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

interface WallClockParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function wallClockParts(epochMs: number, timeZone: string): WallClockParts | null {
  const formatter = formatterFor(timeZone);
  if (formatter === null) return null;
  const values = new Map(
    formatter
      .formatToParts(epochMs)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)] as const),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function addCalendarDays(parts: Pick<WallClockParts, "year" | "month" | "day">, days: number) {
  const shifted = DateTime.add(DateTime.makeUnsafe(parts), { days });
  const date = DateTime.toParts(shifted);
  return { year: date.year, month: date.month, day: date.day };
}

function sameWallClock(
  parts: WallClockParts | null,
  target: Pick<WallClockParts, "year" | "month" | "day" | "hour" | "minute">,
): boolean {
  return (
    parts !== null &&
    parts.year === target.year &&
    parts.month === target.month &&
    parts.day === target.day &&
    parts.hour === target.hour &&
    parts.minute === target.minute
  );
}

/**
 * Convert a local wall-clock minute in an IANA zone to an instant. The short
 * scan around the offset-derived candidate deliberately handles ambiguous DST
 * fall-back minutes (choosing the first candidate after `afterEpochMs`) and
 * rejects spring-forward minutes that do not exist.
 */
function wallClockToEpochMs(
  target: Pick<WallClockParts, "year" | "month" | "day" | "hour" | "minute">,
  timeZone: string,
  afterEpochMs: number,
): number | null {
  if (formatterFor(timeZone) === null) return null;
  const naiveUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  let candidate = naiveUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = wallClockParts(candidate, timeZone);
    if (parts === null) return null;
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const offsetMs = representedAsUtc - Math.floor(candidate / 1000) * 1000;
    candidate = naiveUtc - offsetMs;
  }

  const matching: number[] = [];
  for (let deltaMinutes = -180; deltaMinutes <= 180; deltaMinutes += 1) {
    const instant = candidate + deltaMinutes * MINUTE_MS;
    if (instant <= afterEpochMs) continue;
    if (sameWallClock(wallClockParts(instant, timeZone), target)) matching.push(instant);
  }
  return matching.length === 0 ? null : Math.min(...matching);
}

export function isValidTimeZone(timeZone: string): boolean {
  return formatterFor(timeZone) !== null;
}

export function nextScheduledRunAt(
  schedule: ScheduledTaskSchedule,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  if (schedule.type === "interval") {
    return DateTime.add(from, { milliseconds: schedule.everyMs });
  }

  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null || !isValidTimeZone(schedule.timeZone)) return null;
  const fromEpochMs = DateTime.toEpochMillis(from);
  const localFrom = wallClockParts(fromEpochMs, schedule.timeZone);
  if (localFrom === null) return null;
  const weekdays =
    schedule.weekdays && schedule.weekdays.length > 0 ? new Set(schedule.weekdays) : null;

  for (let offset = 0; offset <= 8; offset += 1) {
    const date = addCalendarDays(localFrom, offset);
    const weekDay = DateTime.toParts(DateTime.makeUnsafe(date)).weekDay;
    if (weekdays !== null && !weekdays.has(weekDay)) continue;
    const candidateMs = wallClockToEpochMs(
      { ...date, hour: time.hour, minute: time.minute },
      schedule.timeZone,
      fromEpochMs,
    );
    if (candidateMs !== null) return DateTime.makeUnsafe(candidateMs);
  }
  return null;
}

function weekdayKey(weekdays: ReadonlyArray<number> | undefined): string {
  const unique = [...new Set(weekdays ?? [])].toSorted((x, y) => x - y);
  if (unique.length === 0 || unique.length === 7) return "daily";
  return unique.join(",");
}

/** Semantic equality for schedules: true iff both fire at the same times. */
export function isSameSchedule(a: ScheduledTaskSchedule, b: ScheduledTaskSchedule): boolean {
  if (a.type === "interval") {
    return b.type === "interval" && a.everyMs === b.everyMs;
  }
  return (
    b.type === "fixed_time" &&
    a.timeOfDay === b.timeOfDay &&
    a.timeZone === b.timeZone &&
    weekdayKey(a.weekdays) === weekdayKey(b.weekdays)
  );
}

/**
 * Fixed-time runs missed by less than a day catch up once after a restart.
 * Older occurrences are recorded as missed and skipped so a machine that was
 * offline for weeks does not unexpectedly execute stale automation work.
 */
export const MISSED_FIXED_TIME_CATCHUP_MS = DAY_MS;

export function isMissedFixedTimeRun(
  schedule: ScheduledTaskSchedule,
  dueAt: DateTime.DateTime,
  now: DateTime.DateTime,
): boolean {
  if (schedule.type !== "fixed_time") return false;
  return DateTime.toEpochMillis(now) - DateTime.toEpochMillis(dueAt) > MISSED_FIXED_TIME_CATCHUP_MS;
}

export function describeSchedule(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / MINUTE_MS;
    if (Number.isInteger(minutes)) {
      return `Every ${minutes === 1 ? "minute" : `${minutes} minutes`}`;
    }
    return `Every ${Math.round(schedule.everyMs / 1000)} seconds`;
  }

  const weekdayCount = schedule.weekdays?.length ?? 0;
  const days =
    weekdayCount === 0
      ? "day"
      : weekdayCount === 5 && schedule.weekdays?.every((day) => day >= 1 && day <= 5)
        ? "weekday"
        : "selected day";
  return `At ${schedule.timeOfDay} every ${days} (${schedule.timeZone})`;
}
