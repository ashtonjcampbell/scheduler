import { redirect } from "next/navigation";

/** Folded into Posts. The queue is now the "Schedule" view of that page. */
export default function QueueRedirect() {
  redirect("/posts?view=schedule");
}
