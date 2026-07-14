# m-way app

Single-file React app for managing production budgets, quotations, invoices, hosting events, and audience CRM.

**Live:** [m-way.co](https://m-way.co)

## Stack

- **Frontend:** React (via Babel standalone), single HTML file — no build step
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions + Database Webhooks)
- **Notifications:** Web Push (VAPID, iOS PWA supported)
- **Hosting:** Vercel (static)

## Structure

```
.
├── index.html                    # The React app (single-file)
├── sw.js                         # Service Worker (push notifications)
├── manifest.json                 # PWA manifest
├── vercel.json                   # Vercel routing config
├── supabase/
│   ├── functions/
│   │   └── handle-event/         # Edge Function: fans out DB webhooks → push
│   └── migrations/               # SQL migrations (run in order in Supabase SQL editor)
└── docs/
    └── release-notes/            # Version history
```

## Local development

Just open `index.html` in a browser. No build, no server needed.
For PWA/Service Worker features, use a local server:
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

Vercel auto-deploys on push to `main`. No config needed beyond `vercel.json`.

## Supabase setup (first-time)

1. Create Supabase project
2. Run each SQL file in `supabase/migrations/` in order via SQL Editor
3. Deploy Edge Function `handle-event`
4. Add secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
5. Configure Database Webhooks (see release notes v2.1 for the SQL)
6. Update `SUPABASE_URL` + `SUPABASE_ANON_KEY` constants in `index.html`

## Versions

- **v2.0 Wayfinder** 🧭 — search, drag-reorder, brand identity
- **v2.1 Pulse** 🔔 — Web Push notifications (iOS PWA + Edge Function)
- **v2.2** (in progress) — Audience CRM, Hosting events, Surveys
