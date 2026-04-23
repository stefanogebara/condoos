# CondoOS

**An AI-powered operating system for condominiums.** Packages, visitors, amenities, meetings, voting, suggestions, and AI-drafted proposals and summaries — all in one soft, tactile interface.

Design language: **claymorphism + glassmorphism**. Muted sage / dusty peach / cream palette. Frosted glass cards layered over rich gradient backgrounds and soft 3D clay illustrations.

## Quickstart

```bash
# Install everything
npm run install:all

# Seed demo data
npm run seed

# Run both server (4000) and client (3000)
npm run dev
```

Then open `http://localhost:3000`.

### Demo accounts

| Role        | Email                    | Password      |
| ----------- | ------------------------ | ------------- |
| Board admin | `admin@condoos.dev`      | `admin123`    |
| Resident    | `resident@condoos.dev`   | `resident123` |

Four more residents (Jordan, Taylor, Riley, Sam) are seeded with password `resident123` for vote/comment demos.

## The demo flow

1. **Resident logs in** → overview dashboard
2. **Submits a suggestion** ("lobby AC is broken, it's 30°C inside")
3. **AI drafts a proposal** — title, description, category, estimated cost
4. **Discussion** — other residents comment; AI summarizes the thread on demand
5. **Board opens voting** — residents vote live
6. **Board holds a meeting** → pastes raw notes → **AI produces** summary, decisions, action items, and a resident-friendly announcement
7. **Published** as an announcement with tracked action items

## Architecture

```
condoos/
├── server/          # Express + TypeScript + SQLite (better-sqlite3)
│   └── src/
│       ├── db/      # schema + seed
│       ├── routes/  # auth, packages, visitors, amenities, announcements,
│       │           # suggestions, proposals, meetings, users, ai
│       ├── ai/      # OpenRouter client, prompts, fallbacks
│       └── lib/     # auth middleware, response helpers
├── client-app/      # React 18 + CRA + Tailwind
│   └── src/
│       ├── pages/   # Login, Dashboard (resident), Board (admin)
│       ├── components/
│       └── lib/
└── package.json     # workspace root
```

### Tech

- **Frontend**: React 18 + TypeScript, Tailwind (custom clay/glass tokens), react-router, axios, react-hot-toast, lucide-react
- **Backend**: Node 20 + Express 4 + TypeScript, better-sqlite3 (zero-config, WAL mode), Zod, bcryptjs, jsonwebtoken, morgan
- **AI**: OpenRouter → `anthropic/claude-3.5-haiku` with deterministic fallbacks so the demo never fails, even offline
- **Storage**: SQLite file at `server/data/condoos.sqlite` (WAL). Reset with `npm run seed`.

## AI features

| Endpoint                                  | What it does                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /api/ai/proposal-draft`             | Turns a free-text suggestion into a structured proposal                      |
| `POST /api/ai/cluster-suggestions`        | Groups similar complaints into themed clusters                               |
| `POST /api/ai/proposals/:id/summarize-thread` | Summarizes a discussion (agreements, disagreements, open questions)      |
| `POST /api/ai/proposals/:id/explain`      | Plain-language, resident-facing explanation of a proposal                    |
| `POST /api/ai/proposals/:id/decision-summary` | Board-ready decision summary after a vote closes                        |
| `POST /api/ai/meetings/:id/summarize`     | Raw notes → summary + decisions + action items + resident announcement draft |

Every AI endpoint has a **deterministic fallback** — if `OPENROUTER_API_KEY` is missing or the model errors, the endpoint returns a sensible canned response tagged with `_fallback: true`. Demos never hang.

## Environment

Copy `.env.example` to `.env`:

```bash
PORT=4000
JWT_SECRET=change-me
DB_PATH=./data/condoos.sqlite
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=anthropic/claude-3.5-haiku
```

## License

MIT.
