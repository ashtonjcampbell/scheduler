"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/media", label: "Media" },
  { href: "/posts", label: "Posts" },
  { href: "/ideas", label: "Ideas" },
  { href: "/hashtags", label: "Hashtags" },
  { href: "/settings", label: "Settings" },
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {SECTIONS.map((section) => {
        // Every section is a real path now that the overview is gone, so a
        // prefix match is enough — /posts/<id> should light up Posts.
        const active = pathname.startsWith(section.href);

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-md bg-stone-200 px-2.5 py-1 text-xs font-medium dark:bg-stone-800"
                : "rounded-md px-2.5 py-1 text-xs text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
            }
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
