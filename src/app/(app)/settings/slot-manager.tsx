"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ScheduleSlot } from "@/lib/database.types";
import { WEEKDAY_NAMES, formatSlotTime } from "@/lib/time";
import { addSlot, setSlotActive, deleteSlot } from "./actions";

export function SlotManager({ slots }: { slots: ScheduleSlot[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [weekday, setWeekday] = useState(2); // Tuesday
  const [time, setTime] = useState("10:00");

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const active = slots.filter((s) => s.active);

  // Grouped by day so the week reads as a week rather than a flat list.
  const byDay = WEEKDAY_NAMES.map((name, index) => ({
    name,
    index,
    slots: slots.filter((s) => s.weekday === index),
  }));

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Weekly posting times</h2>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {active.length === 0
            ? "None yet — the queue can't schedule anything"
            : `${active.length} slot${active.length === 1 ? "" : "s"} a week`}
        </span>
      </div>

      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
        Anything in the queue takes the next free slot. All times are Pacific,
        and stay put across daylight saving.
      </p>

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        action={() => run(() => addSlot(weekday, time))}
      >
        <label className="text-xs">
          <span className="block text-stone-500 dark:text-stone-400">Day</span>
          <select
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
            className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-950"
          >
            {WEEKDAY_NAMES.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <span className="block text-stone-500 dark:text-stone-400">Time</span>
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-950"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
        >
          Add slot
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <ul className="mt-4 space-y-2">
        {byDay.map((day) => (
          <li key={day.name} className="flex items-baseline gap-3 text-sm">
            <span
              className={
                day.slots.length
                  ? "w-24 shrink-0 font-medium"
                  : "w-24 shrink-0 text-stone-400 dark:text-stone-600"
              }
            >
              {day.name}
            </span>

            {day.slots.length === 0 ? (
              <span className="text-xs text-stone-400 dark:text-stone-600">—</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {day.slots.map((slot) => (
                  <span
                    key={slot.id}
                    className={
                      slot.active
                        ? "flex items-center gap-1.5 rounded-full border border-stone-300 py-0.5 pl-2.5 pr-1 text-xs dark:border-stone-700"
                        : "flex items-center gap-1.5 rounded-full border border-dashed border-stone-300 py-0.5 pl-2.5 pr-1 text-xs text-stone-400 dark:border-stone-700 dark:text-stone-600"
                    }
                  >
                    {formatSlotTime(slot.local_time)}

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setSlotActive(slot.id, !slot.active))}
                      title={slot.active ? "Pause this slot" : "Use this slot again"}
                      className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
                    >
                      {slot.active ? "⏸" : "▶"}
                    </button>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(`Remove ${day.name} ${formatSlotTime(slot.local_time)}?`)) {
                          run(() => deleteSlot(slot.id));
                        }
                      }}
                      aria-label="Remove slot"
                      className="text-stone-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
        Pausing a slot keeps it for later; the queue simply skips it.
      </p>
    </section>
  );
}
