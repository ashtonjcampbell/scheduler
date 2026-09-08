import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  images: {
    // Processed photos are served from Supabase Storage's public CDN.
    // The hostname is derived from the project URL so there is one place to
    // configure Supabase, not two.
    remotePatterns: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? [
          {
            protocol: "https",
            hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
    // Our pipeline has already produced exactly the file we want at exactly
    // the right size and colour space. Re-encoding it here would undo that
    // work and risk reintroducing a colour shift, which is the entire problem
    // this app exists to solve.
    unoptimized: true,
  },
};

// Makes Cloudflare bindings available during `next dev`.
initOpenNextCloudflareForDev();

export default nextConfig;
