"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { photoUrl, formatBytes, USAGE_LABELS } from "@/lib/photos";
import { formatPacific } from "@/lib/time";
import type { Photo, PhotoUsage } from "@/lib/database.types";
import { trashPhoto, restorePhoto, deleteForever, retryPhoto, updateAltText } from "./actions";

export function PhotoCard({
  photo,
  usage,
  inTrash = false,
}: {
  photo: Photo;
  usage: PhotoUsage;
  inTrash?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const locked = usage === "scheduled" || usage === "posted";

  return (
    <figure
      className={
        inTrash
          ? "overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-950"
          : "overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
      }
    >
      <div className="relative aspect-square bg-stone-100 dark:bg-stone-950">
        {photo.status === "ready" && photo.storage_path ? (
          // Deliberately a plain <img>: this file is already exactly what we
          // intend to deliver, and putting it through an optimiser would
          // re-encode it and risk the colour shift the pipeline exists to
          // prevent. It is also the true preview — what Instagram receives.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(photo.storage_path)}
            alt={photo.alt_text ?? photo.original_filename}
            loading="lazy"
            className={inTrash ? "h-full w-full object-cover opacity-50" : "h-full w-full object-cover"}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <StatusPlaceholder status={photo.status} error={photo.processing_error} />
          </div>
        )}

        {photo.missing_color_profile && (
          <span
            title="This photo arrived with no colour profile, so its colours were assumed rather than converted. Check it before scheduling."
            className="absolute left-2 top-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950"
          >
            No colour profile
          </span>
        )}

        <span className="absolute right-2 top-2 rounded bg-stone-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
          {inTrash && photo.deleted_at
            ? `Deleted ${formatPacific(photo.deleted_at)}`
            : USAGE_LABELS[usage]}
        </span>
      </div>

      <figcaption className="space-y-1 p-3">
        <p className="truncate text-xs font-medium" title={photo.original_filename}>
          {photo.original_filename}
        </p>

        <p className="text-[11px] text-stone-500 dark:text-stone-400">
          {photo.width && photo.height
            ? `${photo.width}×${photo.height} · ${formatBytes(photo.bytes)}`
            : "—"}
        </p>

        <p
          className="truncate text-[11px] text-stone-500 dark:text-stone-400"
          title={photo.source_color_profile ?? undefined}
        >
          {photo.source_color_profile
            ? `From ${photo.source_color_profile}`
            : photo.status === "ready"
              ? "No embedded profile"
              : ""}
        </p>

        <div className="flex items-center gap-2 pt-1">
          {inTrash ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => restorePhoto(photo.id))}
                className="text-[11px] font-medium text-stone-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-stone-300"
              >
                Put back
              </button>

              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (
                    confirm(
                      `Permanently delete ${photo.original_filename}? This cannot be undone.`,
                    )
                  ) {
                    run(() => deleteForever(photo.id));
                  }
                }}
                className="ml-auto text-[11px] text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
              >
                Delete forever
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="text-[11px] text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline dark:text-stone-400 dark:hover:text-stone-100"
              >
                {photo.alt_text ? "Edit alt text" : "Add alt text"}
              </button>

              {photo.status === "failed" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => retryPhoto(photo.id))}
                  className="text-[11px] text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  Retry
                </button>
              )}

              {/* No confirmation dialog: this is reversible, and the trash is
                  the confirmation. The irreversible step asks instead. */}
              {!locked && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => trashPhoto(photo.id))}
                  className="ml-auto text-[11px] text-stone-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-50 dark:text-stone-400 dark:hover:text-red-400"
                >
                  Move to trash
                </button>
              )}
            </>
          )}
        </div>

        {open && !inTrash && (
          <AltTextField
            photoId={photo.id}
            initial={photo.alt_text ?? ""}
            onDone={() => setOpen(false)}
            onError={setError}
          />
        )}

        {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      </figcaption>
    </figure>
  );
}

function AltTextField({
  photoId,
  initial,
  onDone,
  onError,
}: {
  photoId: string;
  initial: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="pt-1"
      action={() =>
        startTransition(async () => {
          const result = await updateAltText(photoId, value);
          if (result.error) onError(result.error);
          else {
            router.refresh();
            onDone();
          }
        })
      }
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={2}
        placeholder="Describe the photo for screen readers"
        className="w-full rounded border border-stone-300 bg-white p-1.5 text-[11px] outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950"
      />
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded bg-stone-900 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function StatusPlaceholder({
  status,
  error,
}: {
  status: Photo["status"];
  error: string | null;
}) {
  if (status === "failed") {
    return (
      <span className="text-[11px] text-red-600 dark:text-red-400">
        {error ?? "Processing failed"}
      </span>
    );
  }

  return (
    <span className="text-[11px] text-stone-500 dark:text-stone-400">
      {status === "processing" ? "Converting colours…" : "Waiting to process…"}
    </span>
  );
}
