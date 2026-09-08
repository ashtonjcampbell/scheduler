import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";

/**
 * Everything the user sees is Pacific wall-clock time; everything stored is
 * UTC. This module is the only place that bridges the two, so there is exactly
 * one thing to change if the business ever moves timezone.
 *
 * Weekly slots are stored as (weekday, local_time) rather than as instants on
 * purpose: a 10am slot must stay 10am across the daylight-saving boundary,
 * which a fixed UTC offset cannot do.
 */

export const TIMEZONE = "America/Los_Angeles";

/** 0 = Sunday, matching both `Date.getDay()` and the `schedule_slots.weekday` column. */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** View an instant as Pacific wall-clock time. */
export function inPacific(instant: Date | string | number): TZDate {
  return new TZDate(new Date(instant), TIMEZONE);
}

/**
 * Resolve a Pacific wall-clock time on a given Pacific day to a real instant.
 *
 * `localTime` is "HH:MM" or "HH:MM:SS", as stored in `schedule_slots.local_time`.
 * Constructing a TZDate from parts interprets those parts in the given zone,
 * which is what makes this daylight-saving-correct.
 */
export function pacificWallClockToInstant(day: Date, localTime: string): Date {
  const parts = localTime.split(":").map(Number);

  // A malformed slot time must not silently become midnight — a post going
  // out at 00:00 instead of 10:00 is the kind of thing nobody notices until
  // it has happened.
  const hours = parts[0];
  if (hours === undefined || Number.isNaN(hours)) {
    throw new Error(`Invalid slot time: "${localTime}"`);
  }

  const minutes = parts[1] ?? 0;
  const seconds = parts[2] ?? 0;
  const local = inPacific(day);

  return new Date(
    new TZDate(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      hours,
      minutes,
      seconds,
      0,
      TIMEZONE,
    ).getTime(),
  );
}

/**
 * Every instant at which a weekly slot falls, in chronological order, starting
 * from `from` and walking forward `days` days.
 *
 * This is the timetable the rolling queue draws from: the queue itself decides
 * which of these are already taken.
 */
export function upcomingSlotInstants(
  slots: ReadonlyArray<{ id: string; weekday: number; local_time: string }>,
  from: Date,
  days: number,
): Array<{ slotId: string; at: Date }> {
  const results: Array<{ slotId: string; at: Date }> = [];
  const firstDay = startOfDay(inPacific(from));

  for (let offset = 0; offset <= days; offset++) {
    const day = addDays(firstDay, offset);
    const weekday = inPacific(day).getDay();

    for (const slot of slots) {
      if (slot.weekday !== weekday) continue;

      const at = pacificWallClockToInstant(day, slot.local_time);
      // Slots earlier today have already gone by.
      if (at.getTime() <= from.getTime()) continue;

      results.push({ slotId: slot.id, at });
    }
  }

  results.sort((a, b) => a.at.getTime() - b.at.getTime());
  return results;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** e.g. "Tue, Sep 2, 10:00 AM" — always Pacific, regardless of the viewer. */
export function formatPacific(instant: Date | string | number): string {
  return dateTimeFormatter.format(new Date(instant));
}

/** Render a stored "HH:MM:SS" slot time as "10:00 AM". */
export function formatSlotTime(localTime: string): string {
  const [hours, minutes] = localTime.split(":").map(Number);
  const reference = new Date(Date.UTC(2000, 0, 1, hours, minutes));

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(reference);
}

export { timeFormatter };
