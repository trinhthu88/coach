import type { Client } from "@/hooks/coach/types";

export const PALETTES = [
  "bg-primary-soft text-primary",
  "bg-success/15 text-success",
  "bg-warning/15 text-warning",
  "bg-accent text-accent-foreground",
  "bg-secondary text-secondary-foreground",
];

export const FILLS = ["bg-success", "bg-primary", "bg-warning", "bg-accent"];

export function paletteFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

export function initialsOf(s: string) {
  return (s || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function programmeLabel(client: Client, fallback: string): string {
  return client.goalsAll[0]?.title?.split(" ")[0] || fallback;
}
