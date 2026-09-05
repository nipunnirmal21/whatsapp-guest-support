# Database and Migrations

The backend uses Supabase/PostgreSQL. Runtime access uses the Supabase service-role client; schema changes use a direct PostgreSQL connection.

## Connection variables

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | Runtime backend | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime backend | Server-only key that bypasses RLS |
| `SUPABASE_DB_URL` | Migration/integration commands | Direct PostgreSQL URI |
| `DATABASE_URL` | Migration/integration fallback | Useful for CI test databases |

Never expose the service-role key or direct database URI to the frontend.

## Core tables

| Table | Purpose |
|---|---|
| `webhook_raw_events` | Raw Meta event audit trail |
| `apartments` | Apartment details and structured Wi-Fi data |
| `apartment_policies` | Check-in/out, parking, pet, occupancy, and fee policies |
| `owners` | Optional apartment-owner data |
| `guests` | Guest identity and phone number |
| `reservations` | Booking reference, dates, status, guest, apartment |
| `admin_users` | Dashboard operators, supervisors, and admins, linked to Supabase Auth by `auth_user_id` |
| `conversations` | WhatsApp thread, reservation link, assignment, AI state |
| `messages` | Inbound/outbound content and current delivery state |
| `message_delivery_events` | Durable provider status-event history |
| `maintenance_cases` | Maintenance issue records |
| `escalations` | Human handover lifecycle |
| `conversation_events` | Assignment/manual-mode/escalation audit events |
| `automation_settings` | Single global row controlling automated sending |

## Migration map

Migrations run in numeric filename order.

| Migration | Purpose |
|---|---|
| `001_initial_schema.sql` | Core apartments, guests, reservations, conversations, messages, escalations |
| `002_conversation_ai_fields.sql` | Initial conversation AI classification/draft fields |
| `003_ai_outcome_workflow.sql` | AI action state, message failure reason, atomic escalation RPC |
| `004_automation_settings.sql` | Global dashboard automation controls |
| `005_human_handover.sql` | Assignment, Take Over, manual mode, resolve, conversation audit events |
| `006_reservation_fallback.sql` | Booking/name lookup keys and atomic conversation linking |
| `007_whatsapp_delivery_statuses.sql` | Durable delivery events and ordered status reconciliation |
| `008_transaction_safe_escalations.sql` | Open-escalation uniqueness, lifecycle constraints, create/resolve hardening |
| `009_supabase_dashboard_auth.sql` | Supabase Auth UUID binding for dashboard operators |

## Applying migrations

From `backend/`:

```powershell
npm.cmd run migrate
```

The runner reads every `.sql` file, sorts numerically, and executes it against `SUPABASE_DB_URL` (or `DATABASE_URL`). There is currently no migration ledger table, so every run replays every file. Migrations are therefore written to be idempotent with `IF NOT EXISTS`, upserts, and `CREATE OR REPLACE FUNCTION` where appropriate.

### Production safety

Before a production migration:

1. Take a verified database backup.
2. Review every migration not yet applied in that environment.
3. Confirm existing rows satisfy new constraints.
4. Schedule an appropriate deployment window for indexes/table validation.
5. Apply to a staging clone first.
6. Run backend health and workflow smoke tests after migration.
7. Keep a rollback/recovery plan for application and data changes.

Do not use `npm run migrate` casually against an unknown connection string.

## Dashboard operator authentication

Migration 009 adds `admin_users.auth_user_id`, backfills it where an existing
dashboard email matches a Supabase Auth email case-insensitively, and enforces a
unique foreign-key relationship to `auth.users.id`. Create staff accounts through
the Supabase Auth administration interface; the dashboard intentionally has no
public sign-up flow. Any account that is not linked to an allowed `admin_users`
role is denied dashboard API access.

## Reservation matching data

Migration 006 adds normalized keys maintained by triggers:

- `reservations.booking_lookup_key`
- `guests.name_lookup_key`

Conversation matching metadata includes:

- `reservation_id`: verified reservation
- `reservation_candidate_id`: provisional name match
- `reservation_match_method`
- `reservation_match_status`
- `reservation_matched_at`

The `find_or_link_active_conversation` RPC performs active conversation reuse/linking atomically.

## Escalation consistency

Migration 008 enforces:

- Valid conversation/escalation states
- Lifecycle timestamp consistency
- One `pending` or `acknowledged` escalation per conversation
- `resolved_by` attribution
- Conversation-first row locking across create/resolve workflows
- Rejection of attempts to escalate an already resolved conversation
- Idempotent repeated resolution

Important RPCs:

- `ensure_conversation_escalation`
- `take_over_escalation`
- `assign_conversation`
- `start_conversation_manual_mode`
- `resume_conversation_automation`
- `resolve_conversation_handover`

These functions update related rows and audit events within one PostgreSQL transaction. An exception rolls back the entire function call.

## Delivery-status consistency

`apply_whatsapp_delivery_status` records every supported provider event and reconciles the message state using provider timestamps. It supports:

- Duplicate event deduplication
- Out-of-order status arrival
- Events received before the local message row has its WhatsApp message ID
- Structured/bounded failure details

Do not update message delivery state directly from webhook code; use the dispatcher/RPC path.

## Test databases

Database integration tests create and remove uniquely identified records, but they still execute real DDL/RPC/data operations. Use a dedicated disposable or isolated test database.

```powershell
$env:SUPABASE_DB_URL='postgresql://...test-database...'
npm.cmd run migrate
npm.cmd run test:integration
```

Never point this command at production.
