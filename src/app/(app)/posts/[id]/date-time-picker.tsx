"use client";

import { useEffect, useRef, useState } from "react";
import { TIMEZONE } from "@/lib/time";

/**
 * A calendar and clock for picking when a post goes out.
 *
 * Replaces `<input type="datetime-local">`, which on Windows means typing
 * "09/10/2026 08:07 PM" segment by segment. Everything here is a click.
 *
 * The value in and out is the same wall-clock string the native input gave
 * ("2026-09-17T10:00"), with no timezone on it — the caller still reads it as
 * Pacific, which is the only zone this app schedules in. Keeping that contract
 * means the timezone handling around it did not have to change.
 *
 * All the date arithmetic runs through `Date.UTC`, never a local-time Date
 * constructor. A calendar built from local Dates shifts a day for anyone whose
 * machine is not on Pacific, which is exactly the class of bug this app has to
 * avoid.
 */

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"] as const;

/** Where the picker lands when opened with nothing chosen — a normal posting hour. */
const DEFAULT_TIME = "10:00";

export function DateTimePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  const today = pacificToday();

  const [chosenDate, chosenTime] = value ? splitValue(value) : [null, DEFAULT_TIME];

  // Which month the calendar is showing. Follows the chosen date when there is
  // one, so reopening the picker lands where the post actually is.
  const [month, setMonth] = useState(() => {
    const start = chosenDate ?? today;
    return { year: start.year, month: start.month };
  });

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const emit = (date: CalendarDate | null, time: string) => {
    if (!date) return;
    onChange(`${iso(date)}T${time}`);
  };

  const pickDay = (day: number) => {
    emit({ year: month.year, month: month.month, day }, chosenTime);
  };

  const pickTime = (time: string) => {
    // Choosing a time before a date is reasonable; it just needs a day to land
    // on, and today is the only sensible guess.
    emit(chosenDate ?? today, time);
  };

  const step = (by: number) => {
    const next = new Date(Date.UTC(month.year, month.month + by, 1));
    setMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  const blanks = new Date(Date.UTC(month.year, month.month, 1)).getUTCDay();
  const days = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();

  const [hour12, meridiem] = to12Hour(chosenTime);

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950"
      >
        {value ? describe(value) : "Pick a date and time…"}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-stone-300 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => step(-1)}
              className="rounded px-2 py-0.5 text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              ‹
            </button>
            <span className="text-xs font-medium">{monthLabel(month.year, month.month)}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => step(1)}
              className="rounded px-2 py-0.5 text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              ›
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[10px] text-stone-400">
            {WEEKDAY_INITIALS.map((initial, index) => (
              <span key={index}>{initial}</span>
            ))}
          </div>

          <div className="mt-0.5 grid grid-cols-7 gap-0.5">
            {Array.from({ length: blanks }, (_, i) => <span key={`blank-${i}`} />)}

            {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
              const date = { year: month.year, month: month.month, day };
              const isPast = compare(date, today) < 0;
              const isToday = compare(date, today) === 0;
              const isChosen = chosenDate != null && compare(date, chosenDate) === 0;

              return (
                <button
                  key={day}
                  type="button"
                  // A post cannot be scheduled into the past; the worker would
                  // publish it on its very next run.
                  disabled={isPast}
                  onClick={() => pickDay(day)}
                  className={
                    isChosen
                      ? "rounded py-1 text-xs font-semibold bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                      : isPast
                        ? "py-1 text-xs text-stone-300 dark:text-stone-700"
                        : isToday
                          ? "rounded py-1 text-xs font-medium ring-1 ring-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                          : "rounded py-1 text-xs hover:bg-stone-100 dark:hover:bg-stone-800"
                  }
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-1 border-t border-stone-200 pt-3 dark:border-stone-800">
            <select
              aria-label="Hour"
              value={hour12}
              onChange={(event) => pickTime(to24Hour(Number(event.target.value), chosenTime, meridiem))}
              className="rounded border border-stone-300 bg-white px-1.5 py-1 text-xs dark:border-stone-700 dark:bg-stone-950"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>

            <span className="text-xs text-stone-400">:</span>

            <select
              aria-label="Minute"
              value={chosenTime.slice(3, 5)}
              onChange={(event) => pickTime(`${chosenTime.slice(0, 2)}:${event.target.value}`)}
              className="rounded border border-stone-300 bg-white px-1.5 py-1 text-xs dark:border-stone-700 dark:bg-stone-950"
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <div className="ml-1 flex overflow-hidden rounded border border-stone-300 dark:border-stone-700">
              {(["AM", "PM"] as const).map((half) => (
                <button
                  key={half}
                  type="button"
                  onClick={() => pickTime(to24Hour(hour12, chosenTime, half))}
                  className={
                    meridiem === half
                      ? "bg-stone-900 px-2 py-1 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900"
                      : "px-2 py-1 text-xs hover:bg-stone-100 dark:hover:bg-stone-800"
                  }
                >
                  {half}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto rounded px-2 py-1 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type CalendarDate = { year: number; month: number; day: number };

/** Today where the posts go out, not where the laptop happens to be. */
function pacificToday(): CalendarDate {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);

  return { year: year!, month: month! - 1, day: day! };
}

function splitValue(value: string): [CalendarDate | null, string] {
  const [date, time] = value.split("T");
  if (!date || !time) return [null, DEFAULT_TIME];

  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return [null, DEFAULT_TIME];

  return [{ year, month: month - 1, day }, time.slice(0, 5)];
}

function iso(date: CalendarDate): string {
  return `${date.year}-${pad(date.month + 1)}-${pad(date.day)}`;
}

function compare(a: CalendarDate, b: CalendarDate): number {
  return (
    Date.UTC(a.year, a.month, a.day) - Date.UTC(b.year, b.month, b.day)
  );
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month, 1)));
}

function describe(value: string): string {
  const [date, time] = splitValue(value);
  if (!date) return value;

  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(date.year, date.month, date.day)));

  const [hour, meridiem] = to12Hour(time);
  return `${day} at ${hour}:${time.slice(3, 5)} ${meridiem}`;
}

function to12Hour(time: string): [number, "AM" | "PM"] {
  const hour24 = Number(time.slice(0, 2));
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  return [hour24 % 12 === 0 ? 12 : hour24 % 12, meridiem];
}

function to24Hour(hour12: number, time: string, meridiem: "AM" | "PM"): string {
  const hour24 = meridiem === "PM" ? (hour12 % 12) + 12 : hour12 % 12;
  return `${pad(hour24)}:${time.slice(3, 5)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
