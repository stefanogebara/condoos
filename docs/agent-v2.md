# CondoOS Agent V2

The admin agent is an operations copilot. It can recommend, draft, and prepare actions; external effects still require explicit admin confirmation unless the ticket auto-dispatch gate allows a safe vendor outreach.

## What Changed

- Every agent invocation writes an `agent_runs` row with status, model, fallback flag, duration, plan JSON, trace JSON, and errors.
- The ReAct path has a cited `research_external_vendors` tool for competitor/vendor research.
- Agent responses include `evidence_sources[]` derived server-side from building memory, vendor history, attachment vision, and web citations. The model cannot invent these cards.
- Web research is provider-neutral. Configure a provider in the server env; otherwise the tool returns manual search URLs and must not claim live research.
- `npm run agent:eval` runs a deterministic local harness against `./data/agent-evals.sqlite`.

## Environment

```env
AGENT_USE_REACT=1
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_ENDPOINT=https://api.tavily.com/search
WEB_SEARCH_API_KEY=...
WEB_SEARCH_TIMEOUT_MS=10000
```

Keep `AGENT_USE_REACT=0` until evals pass in the target environment. The single-shot path remains the fallback.

## Safety Rules

- Model confidence alone must not trigger outreach. Auto-dispatch requires server-visible evidence and category-compatible vendors.
- External vendors can only be named when `research_external_vendors` returns `configured=true` with URLs.
- When search is not configured, the agent may return the fallback search URLs as manual next steps only.
- Every outbound WhatsApp/email still flows through existing outreach or ticket dispatch endpoints and is auditable.

## Validation

Run:

```bash
npm --prefix server run agent:eval
npm --prefix server test
npm --prefix server run build
```

For live provider validation, set the search env vars and run the workbench manually with a competitor/options task. Confirm the response shows citations and does not invent phone numbers, prices, certifications, or availability.
