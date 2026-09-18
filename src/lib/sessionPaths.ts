import type { DevelopmentSessionItem } from "@/hooks/journey/developmentSessionTypes";

/** Detail route for a unified development-session row (Sessions page, My Journey, Dashboard). */
export function sessionDetailPath(item: DevelopmentSessionItem): string | null {
  // SessionDetail resolves which table (sessions vs peer_sessions) to read
  // from its `?type=` query param — omitting it for a peer-coaching item
  // makes it look up the id in the wrong table and report "not found".
  if (item.type === "coaching") return `/sessions/${item.sourceId}`;
  if (item.type === "peer_coaching") return `/sessions/${item.sourceId}?type=peer`;
  if (item.type === "mentoring") return `/mentoring/sessions/${item.sourceId}`;
  if (item.type === "triad") return "/triads";
  return null;
}
