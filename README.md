# LabLink — Making College Laboratories More Accessible

GenAI-powered campus laboratory resource-sharing platform: equipment discovery, intelligent slot booking,
project-based access requests, faculty approvals, and fair, explainable conflict resolution.

## Features
- **Discovery**: natural-language equipment search (Gemini when `GEMINI_API_KEY` is set, otherwise a local semantic engine).
- **Booking**: accessible weekly calendar, live validation, fair-use weekly quotas (with deadline boost), check-in / no-show auto-release.
- **Conflict resolution**: ranked options (nearby slot, equivalent equipment, split session, consent-based fair-share swap, smart waitlist) with a transparent priority breakdown (deadline urgency, fair share, project importance, starvation, goodwill).
- **Project access**: students request equipment per project; faculty approve/decline.
- **Smart Planner & Copilot**: spreads required hours before a deadline; chat assistant for discovery/availability/plans.
- **Analytics**: utilisation, demand heatmap, insights, CSV export. **Admin**: roles, quotas, maintenance mode (auto-cancels and notifies), audit log.

## Run
```bash
npm start            # http://localhost:3000 (zero runtime dependencies, Node >= 20)
npm test             # node:test suite (unit + HTTP integration)
```
Demo accounts (password `LabLink@2026`): `aarav@`, `arjun@`, `isha@` (students), `rao@`, `menon@` (faculty), `admin@` — all `@lablink.edu`.
Demo walkthrough: sign in as Arjun, open *RF Spectrum Analyzer*, select tomorrow 11 AM–1 PM → conflict options incl. swap; sign in as `vikram@` to accept.

## Config (env)
`PORT`, `SESSION_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `DEMO_MODE=false`, `DATA_FILE` (JSON persistence), `CAMPUS_TZ`.

## Security
scrypt password hashing, HMAC-signed HttpOnly SameSite=Strict sessions, CSRF header, strict CSP (no inline scripts/styles), rate limiting, input validation, role checks, XSS-safe DOM builder, LLM output validated and prompt-injection constrained.

## Deploy (Cloud Run)
```bash
gcloud run deploy lablink --source . --region <region> --allow-unauthenticated --max-instances 1 \
  --set-env-vars SESSION_SECRET=<random>,GEMINI_API_KEY=<optional>
```
Data is in-memory (reseeded on start); use `--max-instances 1`.
