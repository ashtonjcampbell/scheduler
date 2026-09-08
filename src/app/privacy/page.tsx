export const metadata = { title: "Privacy policy" };

/**
 * Meta requires a reachable privacy policy URL on the app's Basic Settings
 * before it will issue Instagram publishing permissions. This page exists to
 * satisfy that, and describes what the app genuinely does: it is a private,
 * single-operator tool with no other users to collect data from.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-stone-800 dark:text-stone-200">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy policy</h1>

      <div className="mt-6 space-y-5 text-sm leading-relaxed">
        <p>
          This is a private scheduling tool used by a single operator to plan
          and publish posts to their own Instagram account. It is not offered
          to the public and has no other users.
        </p>

        <h2 className="pt-2 text-base font-semibold">What is stored</h2>
        <p>
          Photographs uploaded by the operator, caption text, hashtags,
          scheduling times, and the access token that authorises posting to the
          operator&apos;s own Instagram account. This data is held in a private
          Supabase project controlled by the operator.
        </p>

        <h2 className="pt-2 text-base font-semibold">
          What is not collected
        </h2>
        <p>
          No data is gathered about visitors, followers, or any other Instagram
          user. There is no analytics, advertising, or third-party tracking.
          Usernames tagged in a photo are stored only as part of the post being
          published, exactly as they would be if typed into the Instagram app.
        </p>

        <h2 className="pt-2 text-base font-semibold">What is shared</h2>
        <p>
          Nothing is sold or shared. Post content is transmitted to Meta&apos;s
          Instagram Graph API for the sole purpose of publishing it to the
          operator&apos;s account, and is thereafter governed by Instagram&apos;s
          own terms and privacy policy.
        </p>

        <h2 className="pt-2 text-base font-semibold">Retention and deletion</h2>
        <p>
          The operator can delete any stored photo, post, or the entire dataset
          at any time. Revoking the app&apos;s access from Instagram&apos;s
          connected-apps settings immediately ends its ability to post.
        </p>

        <h2 className="pt-2 text-base font-semibold">Contact</h2>
        <p>
          Questions about this policy can be sent to the operator at the address
          listed on the associated business website.
        </p>
      </div>
    </main>
  );
}
