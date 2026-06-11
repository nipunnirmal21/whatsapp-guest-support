# WhatsApp Guest Support — MVP Backend

AI-powered WhatsApp support system for an apartment booking & maintenance company.
Built with Node.js · Express · Supabase · OpenAI · Meta WhatsApp Cloud API.

## Project structure

```
whatsapp-guest-support/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── webhooks/whatsapp.js   ← GET/POST Meta webhook endpoints
│   │   │   └── api/                   ← messages, conversations, escalations, intents
│   │   ├── services/
│   │   │   ├── whatsapp/              ← sender.js, parser.js
│   │   │   ├── reservations/          ← lookup.js (Phase 3)
│   │   │   ├── rules/                 ← engine.js (Phase 4)
│   │   │   └── ai/                    ← classifier.js (Phase 4)
│   │   ├── db/
│   │   │   ├── client.js              ← Supabase client
│   │   │   ├── rawEvents.js           ← audit log helper
│   │   │   └── migrations/            ← SQL migration files
│   │   ├── middleware/
│   │   │   ├── errorHandler.js
│   │   │   └── validateWebhookSignature.js
│   │   ├── utils/logger.js
│   │   └── app.js                     ← Express app
│   ├── server.js                      ← Entry point
│   ├── .env.example
│   └── package.json
├── frontend/                          ← Dashboard (Phase 5)
├── infra/                             ← Deployment configs
└── .gitignore
```

## Quick start

```bash
cd backend
cp .env.example .env        # fill in your values
npm install
npm run dev                 # starts with nodemon on PORT=3000
```

## Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/webhooks/whatsapp` | Meta webhook verification |
| POST | `/webhooks/whatsapp` | Receive inbound messages & status events |
| POST | `/api/messages/send` | Send outbound message (dashboard / automation) |
| GET | `/api/conversations` | List conversations (Phase 5) |
| POST | `/api/escalations/create` | Flag conversation for human handover (Phase 5) |

## Phase delivery plan

| Phase | Goal | Status |
|-------|------|--------|
| 0 | Business & access prep | Prerequisites |
| 1 | Meta app & WhatsApp setup | Prerequisites |
| **2** | **Backend foundation + webhooks** | **✅ Complete** |
| 3 | Data model & reservation lookup | 🔜 Next |
| 4 | Rules engine & AI layer | 🔜 Pending |
| 5 | Dashboard & human handover | 🔜 Pending |
| 6 | Templates, QA & deployment | 🔜 Pending |
