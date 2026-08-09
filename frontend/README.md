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
| `VITE_DASHBOARD_API_KEY` | Yes | Value sent as `X-API-Key` to dashboard APIs |
| `VITE_ADMIN_USER_ID` | For operator actions | Existing `admin_users.id` sent as `X-Admin-User-Id` |

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

## Authentication warning

Vite exposes `VITE_*` values to browser JavaScript. The current shared API key and configured admin UUID are suitable for controlled development environments, not public authentication. Add a real user login/session system and backend authorization before exposing the dashboard to untrusted users.

For backend setup and API details, see the repository [README](../README.md) and [API Reference](../docs/API.md).
