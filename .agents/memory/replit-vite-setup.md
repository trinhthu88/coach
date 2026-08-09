---
name: Replit Vite setup for Clariva
description: Vite config requirements for this project to run on Replit's proxied preview.
---

## Rule
`vite.config.ts` must have:
- `host: "0.0.0.0"` — Replit doesn't support IPv6, so `::` fails with EAFNOSUPPORT
- `port: 5000` — Replit webview requires port 5000
- `allowedHosts: true` — preview is served through a proxied iframe from a different origin
- `plugins: [react()]` only — `lovable-tagger` and `@lovable.dev/mcp-js` are Lovable Cloud-only and cause install failures on Replit (removed in Task #3)

**Why:** The original Lovable config used `host: "::"` and `port: 8080`. Port 8080 is not the webview port and IPv6 isn't supported.

**How to apply:** After any task agent merge that touches vite.config.ts, verify these four settings are preserved.
