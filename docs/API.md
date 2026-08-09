# API Reference

Default local base URL: `http://localhost:3000`.

## Authentication

Every `/api/*` endpoint requires either:

```http
X-API-Key: <DASHBOARD_API_KEY>
```

or:

```http
Authorization: Bearer <DASHBOARD_API_KEY>
```

The following operator actions also require an existing `admin_users.id`:

```http
X-Admin-User-Id: <UUID>
```

- Take Over escalation
- Assign conversation
- Start manual mode
- Resume automation
- Send dashboard reply
- Resolve escalation/conversation

## Response conventions

Typical success:

```json
{
  "success": true,
  "data": {}
}
```

Typical error:

```json
{
  "success": false,
  "error": "Error message"
}
```

Some older validation paths return `{ "error": "..." }` without `success`.

## Health and webhooks

### `GET /health`

No authentication. Checks process state and database reachability.

- `200`: service and database available
- `503`: process available but database unavailable

### `GET /webhooks/whatsapp`

Meta verification handshake. Query parameters:

- `hub.mode=subscribe`
- `hub.verify_token=<WEBHOOK_VERIFY_TOKEN>`
- `hub.challenge=<value>`

Returns the challenge as plain text when valid.

### `POST /webhooks/whatsapp`

Meta event endpoint. Requires a valid `X-Hub-Signature-256` HMAC computed from the exact raw body and `META_APP_SECRET`.

The endpoint immediately returns:

```text
EVENT_RECEIVED
```

with status `200`, then processes inbound messages and delivery statuses asynchronously.

## Messages

### `POST /api/messages/send`

Direct internal WhatsApp send endpoint.

```json
{
  "to": "94770000000",
  "text": "Hello from guest support"
}
```

This route calls the low-level sender. For a persisted operator conversation reply, use `/api/conversations/:id/reply`.

## Conversations

### `GET /api/conversations`

Returns conversations ordered by latest activity with assignee and nested reservation/guest/apartment data.

### `GET /api/conversations/:id`

Returns one conversation plus messages ordered oldest to newest.

- `400`: invalid UUID
- `404`: conversation not found

### `PATCH /api/conversations/:id/assignment`

Requires operator identity. Assigns the conversation and enters manual mode.

```json
{
  "assignedTo": "admin-user-uuid"
}
```

Operators may assign themselves. Assigning another operator requires supervisor/admin permission in the database function.

### `POST /api/conversations/:id/manual-mode`

Requires operator identity. Claims the conversation and pauses automation.

```json
{
  "reason": "Guest requested a person"
}
```

`reason` is optional and limited to 500 characters.

### `POST /api/conversations/:id/resume-automation`

Requires operator identity. Releases the assignment, returns the conversation to `open`, and atomically resolves its open escalation.

### `POST /api/conversations/:id/reply`

Requires operator identity. Starts manual mode, persists a human-authored outbound message, sends it to the conversation phone number, and tracks delivery status.

```json
{
  "content": "Our team is checking this for you."
}
```

## Escalations

### `GET /api/escalations`

Returns newest escalations with assignee and conversation/reservation context.

Optional filter:

```http
GET /api/escalations?status=pending
```

Supported database states are `pending`, `acknowledged`, and `resolved`.

### `POST /api/escalations/create`

Creates or reuses the one open escalation for a conversation and updates the conversation atomically.

```json
{
  "conversationId": "conversation-uuid",
  "reason": "Guest requested staff approval",
  "escalatedTo": "optional-admin-user-uuid"
}
```

- `201`: escalation created
- `200`: existing open escalation reused
- `409`: resolved conversation or conflicting assignment

### `POST /api/escalations/:id/take-over`

Requires operator identity. Atomically assigns the escalation to the operator, changes it to `acknowledged`, and changes the conversation to `manual`.

### `POST /api/escalations/resolve`

Requires operator identity. Atomically resolves the conversation and all open escalation records.

```json
{
  "conversationId": "conversation-uuid"
}
```

Repeated resolve calls are idempotent and do not duplicate the normal resolved audit event.

## Intent classification

### `POST /api/intents/classify`

Side-effect-free classification preview. It runs verified deterministic rules first, then AI.

Use one of the following bodies:

```json
{
  "text": "What is the Wi-Fi password?",
  "conversationId": "conversation-uuid"
}
```

```json
{
  "text": "My booking ID is BK-1001",
  "phoneNumber": "+94 77 000 0000"
}
```

```json
{
  "text": "I need help"
}
```

Rules:

- `text` must be a non-empty string of at most 2,000 characters.
- Provide at most one of `conversationId` and `phoneNumber`.
- Text-only requests run with unmatched identity context and cannot receive sensitive reservation details.

Example response:

```json
{
  "success": true,
  "data": {
    "classification": "human_handover",
    "draft": "Thanks for your message. A member of our team will assist you shortly.",
    "source": "ai",
    "reservationMatch": {
      "status": "verified",
      "method": "phone",
      "reason": null
    }
  }
}
```

`source` is `rules` or `ai`. This endpoint never sends a WhatsApp message or creates an escalation.

## Automation settings

### `GET /api/settings/automation`

Returns stored and effective settings:

```json
{
  "success": true,
  "data": {
    "aiAutoReplyEnabled": false,
    "autoSendClarifications": true,
    "emergencyDisabled": false,
    "effectiveAiAutoReplyEnabled": false,
    "effectiveAutoSendClarifications": true,
    "updatedAt": "2026-08-09T00:00:00.000Z",
    "source": "database"
  }
}
```

### `PATCH /api/settings/automation`

Accepts either or both boolean settings. Unknown keys are rejected.

```json
{
  "aiAutoReplyEnabled": true,
  "autoSendClarifications": true
}
```

The server-side emergency switch always overrides effective settings.

## Admin users

### `GET /api/admin-users`

Returns `id`, `name`, `email`, and `role` for dashboard assignment controls.

## Rate limits

| Scope | Limit |
|---|---:|
| All `/api/*` routes | 200 requests per 15 minutes |
| `/api/messages/send` | 30 requests per minute |
| `/api/intents/classify` | 20 requests per minute |

Limits are applied in addition to authentication.

## Common errors

| Status | Meaning |
|---:|---|
| `400` | Invalid body, UUID, phone number, setting, or identifier combination |
| `401` | Missing/invalid API key or missing operator identity |
| `403` | Invalid Meta signature or insufficient operator role/ownership |
| `404` | Conversation, escalation, operator, or assignee not found |
| `409` | Invalid state transition or assignment conflict |
| `429` | Rate limit reached |
| `500` | Server configuration or internal/provider/database failure |
| `503` | Health check could not reach the database |
