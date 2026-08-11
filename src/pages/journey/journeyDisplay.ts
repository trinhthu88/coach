export const ACCENTS = [
  { bg: "bg-success/15", text: "text-success", fill: "bg-success" },
  { bg: "bg-primary/15", text: "text-primary", fill: "bg-primary" },
  { bg: "bg-warning/15", text: "text-warning", fill: "bg-warning" },
  { bg: "bg-accent", text: "text-accent-foreground", fill: "bg-foreground/60" },
] as const;

export function initials(s: string) {
  return s
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
