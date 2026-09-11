import { redirect } from "next/navigation";

/**
 * There is no overview any more.
 *
 * It showed six counts and a list of what was going out next — every one of
 * which is on the page it belongs to: the media bank counts its own photos in
 * its filter tabs, and the queue is a better answer to "what is going out"
 * than a summary of it could be. So it was a screen to read before getting to
 * the screen you wanted.
 *
 * It was also the most expensive page in the app by a wide margin — six
 * separate count queries, and roughly half a second of CPU on a runtime that
 * measures its budget in milliseconds. It is the page that took the app down.
 *
 * The media bank takes its place, because that is where the work starts:
 * photos arrive, and a post is made from them.
 */
export default function Home() {
  redirect("/media");
}
