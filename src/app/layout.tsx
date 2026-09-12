import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Scheduler",
    template: "%s · Scheduler",
  },
  description: "Instagram planning and scheduling.",
  // A private tool: keep it out of search results entirely.
  robots: { index: false, follow: false },
};

/*
 * Stamp the chosen theme before anything is drawn.
 *
 * The choice lives in localStorage, which the server cannot read — so without
 * this the page paints in the device's theme and then snaps to the chosen one
 * as soon as React starts. On a light phone with dark chosen that is a white
 * flash in the face, every single navigation.
 *
 * It runs blocking in <head> on purpose. It is three lines, and the whole
 * point is that it finishes before the first pixel.
 *
 * Kept in step with src/components/theme-toggle.tsx, which writes the key.
 */
const STAMP_THEME = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: STAMP_THEME }} />
      </head>
      <body className="flex min-h-full flex-col bg-stone-50 dark:bg-stone-950">
        {children}
      </body>
    </html>
  );
}
