import { supabaseAdmin } from "./supabase";

export type AppRole = "admin" | "coach" | "coachee";

const ROLE_PRIORITY: Record<AppRole, number> = { admin: 1, coach: 2, coachee: 3 };

export async function getUserRole(userId: string): Promise<AppRole | null> {
  const { data, error } = await supabaseAdmin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error || !data || data.length === 0) return null;
  const roles = data.map((r) => r.role as AppRole);
  return roles.sort((a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b])[0];
}

export function generatePassword(): string {
  const lowers = "abcdefghijkmnpqrstuvwxyz";
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = lowers + uppers + digits + symbols;
  const buf = new Uint8Array(14);
  crypto.getRandomValues(buf);
  const pick = (set: string, byte: number) => set[byte % set.length];
  const chars = [
    pick(lowers, buf[0]),
    pick(uppers, buf[1]),
    pick(digits, buf[2]),
    pick(symbols, buf[3]),
    ...Array.from(buf.slice(4)).map((b) => pick(all, b)),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
