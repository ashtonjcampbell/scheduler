"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/media", label: "Media" },
  { href: "/posts", label: "Posts" },
  { href: "/ideas", label: "Notes" },
  { href: "/hashtags", label: "Hashtags" },
  { href: "/settings", label: "Settings" },
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {SECTIONS.map((section) => {
        // Every section is a real path, so a prefix match is enough —
        // /posts/<id> should light up Posts.
        const active = pathname.startsWith(section.href);

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "shrink-0 rounded-md bg-stone-200 px-3 py-1.5 text-sm dark:bg-stone-800"
                : "shrink-0 rounded-md px-3 py-1.5 text-sm text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            }
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
