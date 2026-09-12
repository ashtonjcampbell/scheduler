import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SlotManager } from "./slot-manager";
import { GeneralSettings } from "./general-settings";
import { InstagramConnect } from "./instagram-connect";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const notice = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: slots }, { data: settings, error }] = await Promise.all([
    supabase
      .from("schedule_slots")
      .select("*")
      .order("weekday", { ascending: true })
      .order("local_time", { ascending: true }),
    supabase.from("app_settings").select("*").single(),
  ]);

  // app_secrets has no read policy, so a signed-in session cannot see it —
  // that is what keeps the tokens out of the browser. Only the App ID is read
  // here, and only to show whether credentials have been entered. The secret
  // and the tokens are never selected.
  let credentials: { ig_app_id: string | null } | null = null;
  try {
    const { data } = await supabaseAdmin()
      .from("app_secrets")
      .select("ig_app_id")
      .single();
    credentials = data;
  } catch {
    // No service key configured yet — the panel simply offers to add
    // credentials, which is the correct state before setup.
  }

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
      </div>

      <InstagramConnect
        settings={settings}
        hasCredentials={Boolean(credentials?.ig_app_id)}
        appId={credentials?.ig_app_id ?? null}
        notice={notice}
      />
      <SlotManager slots={slots ?? []} />
      <GeneralSettings settings={settings} />
    </div>
  );
}
