"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  formatBytes,
  uploadPathFor,
} from "@/lib/photos";
import { requestProcessing } from "./actions";

/**
 * Each file gets a stable id at the moment it is added.
 *
 * Batches are additive and may overlap — you can drop twenty photos, then drop
 * twenty more before the first lot has finished. So progress is tracked by id
 * rather than by position in the list: two in-flight batches would otherwise
 * write over each other's rows.
 */
type Item = {
  id: string;
  name: string;
  state: "uploading" | "done" | "error";
  error?: string;
};

export function UploadZone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      // Each file's id doubles as its photo id, so the row, the storage path
      // and this progress row all agree.
      const batch = files.map((file) => ({
        file,
        item: {
          id: crypto.randomUUID(),
          name: file.name,
          state: "uploading" as const,
        },
      }));

      setNotice(null);
      setItems((prev) => [...prev, ...batch.map((entry) => entry.item)]);

      const supabase = supabaseBrowser();
      let uploaded = 0;

      // Sequential within a batch: a set of 40MP originals uploaded in
      // parallel saturates a domestic connection and makes every file slower
      // than doing them one at a time.
      for (const { file, item } of batch) {
        const failure = validate(file);
        if (failure) {
          patch(item.id, { state: "error", error: failure });
          continue;
        }

        try {
          const path = uploadPathFor(item.id, file.name);

          const { error: storageError } = await supabase.storage
            .from("uploads")
            .upload(path, file, { contentType: file.type, upsert: false });

          if (storageError) throw new Error(storageError.message);

          // The row is written only once the file is safely stored, so the
          // worker can never find a pending photo with nothing behind it.
          const { error: rowError } = await supabase.from("photos").insert({
            id: item.id,
            original_filename: file.name,
            upload_path: path,
          });

          if (rowError) {
            // Don't leave the orphaned file sitting in the bucket.
            await supabase.storage.from("uploads").remove([path]);
            throw new Error(rowError.message);
          }

          uploaded++;
          patch(item.id, { state: "done" });
        } catch (error) {
          patch(item.id, {
            state: "error",
            error: error instanceof Error ? error.message : "Upload failed",
          });
        }
      }

      if (uploaded > 0) {
        const result = await requestProcessing();
        setNotice(result.message);
        startTransition(() => router.refresh());
      }

      // Let the same file be picked again after an error.
      if (inputRef.current) inputRef.current.value = "";
    },
    [patch, router],
  );

  const uploading = items.filter((item) => item.state === "uploading").length;
  const failed = items.filter((item) => item.state === "error").length;
  const done = items.filter((item) => item.state === "done").length;

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(Array.from(event.dataTransfer.files));
        }}
        className={
          dragging
            ? "rounded-xl border-2 border-dashed border-stone-500 bg-stone-100 p-8 text-center transition dark:border-stone-400 dark:bg-stone-900"
            : "rounded-xl border-2 border-dashed border-stone-300 p-8 text-center transition dark:border-stone-700"
        }
      >
        <p className="text-sm font-medium">Drop photos here</p>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          JPEG, PNG, TIFF, WebP or AVIF, up to {formatBytes(MAX_UPLOAD_BYTES)} each.
          Add as many batches as you like — they stack up.
        </p>

        {/* Deliberately never disabled: adding a second batch mid-upload is
            supported, and a disabled button would imply otherwise. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          {uploading > 0 ? "Add more photos" : "Choose photos"}
        </button>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          className="sr-only"
          onChange={(event) => void upload(Array.from(event.target.files ?? []))}
        />
      </div>

      {items.length > 0 && (
        <div className="mt-3 rounded-lg border border-stone-200 dark:border-stone-800">
          <div className="flex items-center gap-3 border-b border-stone-200 px-3 py-2 text-xs dark:border-stone-800">
            <span className="font-medium tabular-nums">
              {uploading > 0
                ? `Uploading ${uploading} of ${items.length}`
                : `${done} uploaded`}
              {failed > 0 && `, ${failed} failed`}
            </span>

            {notice && (
              <span className="text-stone-500 dark:text-stone-400">{notice}</span>
            )}

            {uploading === 0 && (
              <button
                type="button"
                onClick={() => {
                  setItems([]);
                  setNotice(null);
                }}
                className="ml-auto text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              >
                Clear
              </button>
            )}
          </div>

          <ul className="max-h-48 overflow-y-auto px-3 py-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-3 py-0.5 text-xs"
              >
                <span className="truncate text-stone-600 dark:text-stone-400">
                  {item.name}
                </span>
                <span
                  className={
                    item.state === "error"
                      ? "shrink-0 text-red-600 dark:text-red-400"
                      : "shrink-0 text-stone-500 dark:text-stone-500"
                  }
                >
                  {item.state === "uploading" && "Uploading…"}
                  {item.state === "done" && "Uploaded"}
                  {item.state === "error" && item.error}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function validate(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    return "Not an accepted image format";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Too large (${formatBytes(file.size)})`;
  }
  return null;
}
