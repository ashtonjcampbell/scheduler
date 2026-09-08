import { supabaseServer } from "@/lib/supabase/server";
import { SlotManager } from "./slot-manager";
import { GeneralSettings } from "./general-settings";
import { InstagramStatus } from "./instagram-status";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await supabaseServer();

  const [{ data: slots }, { data: settings, error }] = await Promise.all([
    supabase
      .from("schedule_slots")
      .select("*")
      .order("weekday", { ascending: true })
      .order("local_time", { ascending: true }),
    supabase.from("app_settings").select("*").single(),
  ]);

  if (error || !settings) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Could not load settings: {error?.message ?? "no settings row"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Posting times, Instagram, and how long things are kept.
        </p>
      </div>

      <InstagramStatus settings={settings} />
      <SlotManager slots={slots ?? []} />
      <GeneralSettings settings={settings} />
    </div>
  );
}
