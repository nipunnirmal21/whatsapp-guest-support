# Operations Guide

## Deployment checklist

1. Provision separate staging and production databases.
2. Back up the target database.
3. Configure backend secrets outside source control.
4. Apply migrations to staging and run smoke/integration tests.
5. Deploy the backend with HTTPS and a stable public URL.
6. Configure the Meta callback URL and verify token.
7. Deploy the dashboard behind trusted access controls.
8. Verify CORS behavior for the deployed dashboard/backend topology.
9. Keep AI auto-reply disabled for initial smoke testing.
10. Verify inbound storage, deterministic rules, AI handover, human reply, and delivery states.
11. Enable automation settings only after review.

## Required backend configuration

The server refuses to start when any of these are missing:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`LLM_API_KEY` is not a startup requirement, but real AI classification requires it. Missing/invalid AI configuration produces a safe human-handover result.

`SUPABASE_DB_URL` is required by migrations and database integration tests, not normal runtime requests.

## Meta webhook setup

Callback URL:

```text
https://<backend-host>/webhooks/whatsapp
```

Configure Meta with the same `WEBHOOK_VERIFY_TOKEN` used by the backend. POST requests must include a signature generated with the same app secret as `META_APP_SECRET`.

Verify both paths:

- GET handshake returns the challenge.
- Signed POST returns `200 EVENT_RECEIVED` quickly.

Do not put heavy work before the POST acknowledgement; Meta retries non-successful/slow deliveries.

## Health and monitoring

```http
GET /health
```

- `200 status=ok`: process and database available
- `503 status=degraded`: process running, database round trip failed

Application logs use Winston console output and daily rotating files:

- `logs/app-YYYY-MM-DD.log`
- `logs/error-YYYY-MM-DD.log`

Monitor at least:

- Health-check failures
- Webhook signature failures
- Inbound processing errors
- AI classifier failures/handover spikes
- WhatsApp send failures
- Buffered/failed delivery events
- Escalation backlog and age
- Database RPC/migration errors

Avoid logging message bodies, credentials, or full phone numbers in new code.

## AI rollout and emergency stop

Recommended rollout:

1. `aiAutoReplyEnabled=false`
2. Review generated drafts and classification outcomes.
3. Verify reservation identity controls and structured data.
4. Enable clarification sending if desired.
5. Enable safe auto-replies gradually.

Emergency stop:

```env
AI_AUTO_REPLY_EMERGENCY_DISABLE=true
```

Restart the backend after changing the environment variable. The effective settings response will show `emergencyDisabled=true`, and automated AI/clarification sending fails closed.

Rules-engine replies are a separate deterministic path. If all automated responses must stop, pause/disable the service or place affected conversations into human-owned mode while applying the operational fix.

## Dashboard access

The dashboard uses Supabase Auth email/password sessions. Provision staff accounts manually, apply migration 009, and link each allowed `admin_users` row to its Supabase Auth UUID. The backend validates every `/api/*` Bearer token and resolves operator identity server-side. Keep the service-role key backend-only; the frontend receives only the public Supabase URL and anon key.

## CORS and hosting

In development, the backend allows all origins. In production, the current backend uses `BASE_URL` as its allowed CORS origin and also uses it when reporting the webhook endpoint at startup. A same-origin deployment works with this model. If frontend and backend use different origins, introduce a dedicated frontend-origin configuration before deployment rather than weakening CORS.

## Migration operations

Run only after confirming the target URI:

```powershell
cd backend
npm.cmd run migrate
```

The runner replays all migration files in order; it does not maintain a migration ledger. Review [Database and Migrations](DATABASE_AND_MIGRATIONS.md) before production use.

## Smoke-test checklist

- `/health` returns 200.
- Invalid webhook signature returns 403.
- Valid Meta webhook is acknowledged.
- Inbound message appears once in the dashboard.
- Known structured question produces the expected rules reply.
- Unknown/sensitive request produces the correct AI/handover outcome.
- Manual mode prevents automated responses.
- Operator reply is persisted before/with sending.
- Delivery state progresses through sent/delivered/read or records a bounded failure.
- Concurrent/repeated escalation actions do not produce duplicate open records.

## Common failures

### Backend exits during startup

Check the startup-required variables and Supabase service-role configuration.

### Health returns 503

Verify `SUPABASE_URL`, service-role key, project availability, and network access.

### Meta verification fails

Confirm `hub.mode=subscribe`, matching verify token, and the public callback URL.

### Webhook POST returns 403

Confirm the raw request body reaches signature middleware unchanged and `META_APP_SECRET` matches the signing app.

### AI always hands over

Check `LLM_API_KEY`, `LLM_MODEL`, provider availability, and classifier error logs. Human handover is the intentional failure mode.

### Reservation details are withheld

Inspect `reservation_match_status` and `reservation_match_method`. Provisional, ambiguous, mismatch, and unmatched identities intentionally receive no sensitive context.

### Delivery status does not update

Confirm migration 007 is applied, Meta status webhooks are subscribed, and the provider WhatsApp message ID matches the outbound record.

### Escalation RPC is missing or inconsistent

Apply migrations through 008 and confirm the service-role account can execute the RPC functions.
