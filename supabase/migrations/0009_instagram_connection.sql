-- ============================================================================
-- Storing the Instagram connection
--
-- Publishing through the Instagram Graph API uses a PAGE access token, not the
-- user token you get back from the login dialog. Both are kept:
--
--   ig_access_token       — the Page token, used to publish
--   ig_user_access_token  — the long-lived user token, which is what the
--                           weekly refresh job actually extends
--
-- Keeping only the Page token would leave nothing to refresh, and the whole
-- connection would quietly expire after 60 days.
--
-- IDEMPOTENT: safe to run repeatedly.
-- ============================================================================

alter table app_secrets
  add column if not exists ig_user_access_token text;

alter table app_settings
  -- The Facebook Page the Instagram account is linked through. Recorded so the
  -- settings screen can show what it connected to, and so a reconnect can tell
  -- whether the underlying Page changed.
  add column if not exists ig_page_id text,
  add column if not exists ig_page_name text;

notify pgrst, 'reload schema';
