# WhatsApp Guest Support Dashboard

React/Vite dashboard for the WhatsApp Guest Support backend. It displays conversations, reservations, delivery states, escalations, automation settings, and operator handover controls.

## Setup

```powershell
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run dev
```

The development server prints its local URL, normally `http://localhost:5173`.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `VITE_API_BASE_URL` | Yes | Backend base URL, for example `http://localhost:3000` |
| `VITE_SUPABASE_URL` | Yes | Public URL for the same Supabase project used by the backend |
| `VITE_SUPABASE_ANON_KEY` | Yes | Public anon key used by Supabase Auth in the browser |

Restart the Vite development server after changing environment variables.

## Dashboard capabilities

- List conversations and view message history
- Display linked guest, reservation, and apartment context
- Show outbound WhatsApp delivery status
- Create, view, Take Over, and resolve escalations
- Assign conversations and start/resume manual mode
- Send human replies
- Read and update AI auto-reply settings

## Commands

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

## Authentication

The dashboard restores a Supabase Auth session, shows email/password login when unauthenticated, and sends the short-lived access token as a Bearer credential. There is no public registration UI. Staff users must be provisioned in Supabase Auth and linked to `admin_users.auth_user_id` by an administrator.

The Supabase URL and anon key are public client configuration. Never place the service-role key or any backend/provider secret in a `VITE_*` variable.

For backend setup and API details, see the repository [README](../README.md) and [API Reference](../docs/API.md).
