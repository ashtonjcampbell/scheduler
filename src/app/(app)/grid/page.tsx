import { redirect } from "next/navigation";

/** Folded into Posts, which now holds the grid, the schedule and the list. */
export default function GridRedirect() {
  redirect("/posts");
}
