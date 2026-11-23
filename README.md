# LabLink — Making College Laboratories More Accessible

**Live demo: https://lablink-liart.vercel.app** · **Source: https://github.com/rex39432320/lab**

LabLink is a GenAI-powered campus laboratory resource-sharing platform. Students discover specialised equipment, development kits and lab workstations across departments, book slots, request project-based access, and get faculty approvals, while the platform **optimises utilisation and resolves scheduling conflicts fairly** using project deadlines, availability and student requirements.

> Built for the PromptWars × Cynergy Coding Club challenge: _"Create a GenAI-powered campus laboratory resource-sharing platform … equipment discovery, intelligent slot booking, project-based access requests, and faculty approvals while optimising resource utilisation. It should intelligently resolve scheduling conflicts by recommending fair and feasible equipment allocations based on project deadlines, availability, and student requirements."_

---

## Table of contents

1. [Challenge → feature map](#1-challenge--feature-map)
2. [Features in detail](#2-features-in-detail)
3. [Quick start](#3-quick-start)
4. [Demo walkthroughs](#4-demo-walkthroughs)
5. [Architecture](#5-architecture)
6. [How the fairness and conflict engine works](#6-how-the-fairness-and-conflict-engine-works)
7. [AI integration (Gemini + local engine)](#7-ai-integration-gemini--local-engine)
8. [Testing](#8-testing)
9. [Security](#9-security)
10. [Accessibility](#10-accessibility)
11. [Efficiency and code quality](#11-efficiency-and-code-quality)
12. [API reference](#12-api-reference)
13. [Configuration](#13-configuration)
14. [Deployment](#14-deployment)
15. [Known limitations and future work](#15-known-limitations-and-future-work)

---

## 1. Challenge → feature map

| Challenge requirement | Where it is implemented |
|---|---|
| Discover specialised equipment, dev kits and workstations across departments | **Discover** page: 37 seeded instruments in 6 departments and 9 categories; natural-language search, filters, demand and next-free-slot on every card; "similar equipment" on every detail page |
| Intelligent slot booking | **Equipment** page: keyboard-accessible weekly calendar, live validation, fair-use weekly quotas, check-in, automatic no-show release, `.ics` calendar export |
| Project-based access requests | **Projects** page + access-request flow; restricted equipment requires an approved request _per project_, shared by the whole team |
| Faculty approvals | **Approvals** inbox for faculty and lab staff: access requests and long bookings, with requester priority, justification, deadline and hours already used |
| Optimise resource utilisation | **Analytics** (utilisation per instrument and department, demand heatmap, daily load, recommendations), smart waitlist, no-show release, load-balancing suggestions, maintenance mode |
| Resolve scheduling conflicts fairly and feasibly | `server/services/resolver.js` + `priority.js`: ranked, explained options (nearby slot, equivalent equipment, split session, consent-based swap, waitlist) driven by deadline, availability and requirements |
| GenAI | Gemini-powered request understanding and explanations (optional), plus a deterministic local engine so the product always works |

---

## 2. Features in detail

### Discovery
- **Describe-what-you-need search.** "I want to capture sensor signals for my IoT project" returns the ESP32 kit, spectrum analyser and SDR, with the matched concepts shown on each card.
- Offline semantic engine (`search.js`): weighted field matching (name ×3, tags ×2.5, category ×2), prefix matching and **concept-group expansion** (e.g. _signal_ ≈ _oscilloscope_, _print_ ≈ _3D printer_, _DNA_ ≈ _PCR_).
- Filters: category, department, bookable now, needs approval; sorting by soonest available or highest demand.
- Each card shows access state (open / needs approval / access granted / pending), 7-day demand and the next free slot.

### Booking
- Weekly calendar: free, booked, booked-but-_flexible_, pending approval, yours, closed, past and maintenance states, never conveyed by colour alone (text and patterns).
- Click a start and end hour; the server validates instantly (opening hours, past slots, maximum length, access, quota, self-overlap, conflicts).
- **Fair-use quota:** 12 h/week per student by default (configurable per user), raised by 50% when the selected project is due within 3 days.
- **Approval for long sessions:** bookings above an instrument's auto-approve limit are held for the project guide or equipment custodian.
- **Check-in and no-show release:** check-in opens 15 minutes before the slot; unclaimed slots are released 30 minutes after start and offered to the waitlist. Ending a session early frees the remainder.
- Reschedule, cancel, mark "I'm flexible", export to calendar.

### Projects and access
- Projects carry a title, description, guide, deadline, kind (capstone / research / course / personal) and planned hours; owners add teammates.
- Students request equipment per project with a justification and hours; the **custodian, the guide or an admin** can approve or decline with a comment, and the requester is notified.
- **AI equipment suggestions** read the project description and propose instruments.

### Conflict resolution (the core of the problem statement)
When a requested slot is taken, LabLink returns ranked options with plain-language reasons:

| Option | What it does |
|---|---|
| Nearby slot | Closest free window of the same length on the same equipment (±7 days, never after the project deadline) |
| Equivalent equipment | Similar instruments (shared category and tags) that are free, or free-but-needing access with a one-click request |
| Split session | Two shorter blocks on the same day when no single window fits |
| Fair-share swap | Ask the current holder to move to a nearby slot; they can accept or decline; accepting earns goodwill credit |
| Smart waitlist | Auto-books the highest-priority waiter when a slot frees up (cancellation, rejection, no-show) |

Every request is scored with a transparent **fair-share priority** (see [section 6](#6-how-the-fairness-and-conflict-engine-works)) that the user can expand to see exactly why.

### Smart Planner and Copilot
- **Planner:** "I need 6 hours on the oscilloscope before Friday" → sessions spread across free days within quota, preferring mornings/afternoons if asked, keeping a buffer before the deadline; one click books all (atomically).
- **Copilot chat:** finds equipment, lists free slots ("tomorrow afternoon"), builds plans, and summarises your bookings, always handing off to the real booking flow so every rule still applies.

### Faculty, lab staff and admin
- Approvals inbox, utilisation analytics (with CSV export) and recommendations (_"X is 56% booked, steer overflow to Y"_).
- Admin: roles, weekly quotas, activate/deactivate users, add equipment, **maintenance mode** (cancels upcoming bookings, notifies users, blocks new ones), full **audit log**.

### Notifications
In-app bell with unread count for approvals, swaps, waitlist promotions, cancellations and no-show releases.

---

## 3. Quick start

Requirements: **Node.js ≥ 20**. There are **no runtime dependencies** (nothing to `npm install`).

```bash
git clone https://github.com/rex39432320/lab.git
cd lab
npm start            # http://localhost:3000
npm test             # 93 tests
npm run lint         # syntax + unused imports
npm run check        # lint + tests (what CI runs)
npm run test:coverage
```

Demo accounts (all use password `LabLink@2026`; hide them with `DEMO_MODE=false`):

| Role | Email | Why use it |
|---|---|---|
| Student | `arjun@lablink.edu` | 5G capstone due in ~4 days: highest priority, has the conflict scenario |
| Student | `vikram@lablink.edu` | Hobby project, holds a _flexible_ slot Arjun wants (the swap target) |
| Student | `aarav@lablink.edu`, `isha@lablink.edu` | Capstones with different equipment and a waitlist entry |
| Faculty | `rao@lablink.edu`, `menon@lablink.edu` | Pending access requests and long-booking approvals |
| Admin | `admin@lablink.edu` | Users, equipment, maintenance, audit log |

Demo data is **generated relative to today**, so the calendars always look live.

---

## 4. Demo walkthroughs

**A. Fair conflict resolution and swap (2 min)**
1. Sign in as `arjun@lablink.edu` → **Discover** → _RF Spectrum Analyzer_.
2. Select **tomorrow 11 AM – 1 PM** (it is booked, with an amber "flexible" underline).
3. LabLink explains the conflict, shows Arjun's **priority 67** and lists options: nearby slots, a swap, the SDR as an equivalent, a split session, an access request for the VNA, and the waitlist.
4. Click **Ask to swap**. Sign out, sign in as `vikram@lablink.edu` → **My Bookings → Swap requests** (priority 67 vs 28) → **Accept & move**. Arjun now owns the slot; Vikram moved to a nearby slot and earned goodwill credit.

**B. Project access approval:** `aarav@` requests the _PCB Prototyping Mill_ for his project → `rao@` approves it in **Approvals** → Aarav can now book it.

**C. Planning with AI:** open **Copilot**, send _"Plan 6 hours on the oscilloscope before Friday"_ → review the proposed sessions → **Book all**.

**D. Utilisation:** sign in as `rao@` or `admin@` → **Analytics** for heatmap, per-instrument load and recommendations; as admin, set an instrument to _maintenance_ and watch affected bookings cancel with notifications.

---

## 5. Architecture

```
Browser (vanilla ES-module SPA, no build step)
   │  JSON over HTTPS, HttpOnly cookie, X-Requested-With header
   ▼
server/app.js     security headers → rate limit → CSRF header → auth → role check → route handler
   ├─ routes/*    thin HTTP layer: validate input → call services → shape output
   ├─ services/*  pure domain logic (testable without HTTP)
   └─ store.js    in-memory collections with atomic JSON-file persistence
```

```
public/
  index.html, css/styles.css           design system (dark/light tokens, glass UI)
  js/dom.js                            XSS-safe hyperscript helper (text nodes only)
  js/ui.js, router.js, state.js        dialogs, toasts, tabs, hash router, shared state
  js/components/                       shell, equipment card, resolution panel, charts
  js/views/                            one module per screen
server/
  app.js, index.js, static.js          pipeline, entry point, gzip/ETag static server
  constants.js, seed.js, store.js      reference data, deterministic demo data, storage
  lib/                                 time, validate, security, router, errors
  routes/                              auth, equipment, bookings, negotiation, projects, ai, analytics, admin, notifications
  services/
    scheduling.js   slot arithmetic, availability, booking validation, quotas
    priority.js     explainable fair-share score
    resolver.js     ranked conflict options
    planner.js      spreads hours before a deadline within quota
    bookings.js     create / cancel / waitlist promotion / no-show sweep
    approvals.js    which pending items a staff member can decide
    search.js       offline semantic search
    ai.js, chat.js  Gemini client with fallbacks; Copilot intent parsing
    analytics.js    utilisation, heatmap, insights
api/index.js       serverless entry (Vercel)
test/              unit + HTTP integration tests (node:test)
scripts/lint.mjs   dependency-free lint
docs/ARCHITECTURE.md, SECURITY.md
```

Key design decisions (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):
- **Dates are `YYYY-MM-DD` strings and hours are numbers**, in campus time (`CAMPUS_TZ`, default `Asia/Kolkata`). This removes timezone and DST bugs from scheduling arithmetic.
- **Services are pure and take the store as an argument**, so the whole engine is testable without a server.
- **AI is an enhancement, never a dependency**: every Gemini call has a deterministic fallback.
- **All-or-nothing bulk booking** (planner output, split sessions) with rollback.

---

## 6. How the fairness and conflict engine works

### Priority score (0–100, `server/services/priority.js`)

| Factor | Weight | Meaning |
|---|---|---|
| Deadline urgency | 40% | `1 − daysLeft/21`, so a deadline 4 days out scores ≈ 0.81 |
| Fair-share remaining | 25% | `1 − hoursUsedThisWeek / weeklyLimit` |
| Project importance | 20% | capstone 1.0 · research 0.9 · course 0.7 · personal 0.35 |
| Time since last access | 10% | days since last lab use ÷ 14 (anti-starvation) |
| Goodwill credit | 5% | accepted swaps ÷ 5 |

The breakdown (`factor`, `value`, `weight`, `points`, `note`) is returned by the API and shown in the UI.

### Swap rules (`resolver.js`)
A swap is offered only if all hold: exactly one conflicting booking; the holder is a different user; the booking is `confirmed`; it has not already been moved once; it starts **≥ 12 h** away; the requester outranks the holder by **≥ 10 points** (or the holder marked the slot _flexible_ and the requester is at least equal); and the holder has a feasible alternative slot. The holder must **consent**; declining adds the requester to the waitlist automatically. Proposals expire after 24 h.

### Other constants
Booking window 21 days · quota boost ×1.5 within 3 days of a deadline · check-in opens 15 min early · no-show release after 30 min · per-equipment maximum and auto-approve hours.

### Planner (`planner.js`)
Spreads `ceil(hours / sessionLength)` sessions across the days before the deadline (spacing 1–2 days), honouring weekly quota, preferred time of day and free windows, then fills remaining gaps; reports any **shortfall** and the buffer left before the deadline.

---

## 7. AI integration (Gemini + local engine)

| Capability | With `GEMINI_API_KEY` | Without a key |
|---|---|---|
| Understand a free-text equipment need | Gemini returns keywords and a category (JSON mode) which feed the search | Local semantic engine with concept expansion |
| Explain a scheduling conflict | Gemini writes a short explanation from the structured facts | Rule-based explanation from the resolver |
| Copilot intents, dates, durations, plans | Local parser (deterministic, no LLM needed) with Gemini-assisted equipment understanding | Same parser and local search |

Safety properties (`server/services/ai.js`):
- User text is passed as **quoted data**, never as instructions.
- Model output must match a constrained JSON shape; keywords are sanitised (`[a-z0-9 +-]`, ≤ 30 chars, ≤ 8) and the category must be one of the known categories. Invented values are discarded.
- Timeouts (7 s), HTTP errors and malformed output all fall back silently to the local engine.
- The API key is sent in the `x-goog-api-key` header, never in the URL and never logged.
- All of this is covered by unit tests with a mocked `fetch`.

---

## 8. Testing

**93 tests in 31 suites, all passing, ~3.3 s** (`npm test`, built-in `node:test`, **no test dependencies**). Line coverage is about **93%**, branches about **86%** (`npm run test:coverage`).

### Test design
- **Deterministic.** The seed is generated from a fixed pseudo-random sequence and a **frozen clock** (Monday 2 Mar 2026, 08:00), so every run sees identical data. Time-dependent behaviour (no-show release, quota boost) is tested by moving an injected clock.
- **Real HTTP.** Integration tests boot the real server on an ephemeral port and use `fetch` with real cookies, so the whole pipeline (headers, rate limiting, CSRF, auth, validation, handlers, serialisation) is exercised.
- **Realistic helpers.** `findFree()` locates genuinely free slots in the seeded data rather than hard-coding times; sessions are cached per user.
- **No silent skips.** Scenarios that depend on seed data assert that data exists instead of returning early.

### What each file covers

| File | Focus |
|---|---|
| `test/scheduling.test.js` | Slot overlap and free windows; every `validateBooking` rule (past, closed day, max length, access, project membership, maintenance, approval threshold, conflict reporting); quota and the deadline boost; priority ordering, breakdown sums and goodwill |
| `test/resolver.test.js` | Conflict explanation; ranking; swap eligibility (and when it must _not_ be offered); equivalent-equipment and access paths; waitlist always present; **no suggested slot is itself in conflict**; holder privacy by role; similarity; planner spread, shortfall and time-of-day; semantic search quality and gibberish handling |
| `test/api.test.js` | **Auth/authz:** 401/403, generic login errors, cookie flags, CSRF header, forged cookies, role isolation, brute-force rate limit with `Retry-After`, registration rules. **Validation/hardening:** 400 with field names, 415/413, security headers, path traversal. **Discovery:** list/filter/search, per-user access state, no leakage of other users' bookings. **Lifecycle:** create → conflict → waitlist → cancel → auto-promotion; quota enforcement; long-booking approval; atomic multi-booking with rollback; ICS export. **Access approval** end to end. **Swap** propose/accept/decline, single open swap, holder-only responses, goodwill. **Maintenance** cancellations. **Analytics, dashboard, Copilot.** **No-show release** with waitlist promotion |
| `test/infra.test.js` | Store persistence (atomic write, corrupt-file recovery); router matching, 404 vs 405, role enforcement; time helpers (leap years, week starts, IST conversion); analytics bounds; static serving (ETag/304, gzip, health probe, **server source never served**); demo-mode switch |
| `test/units.test.js` | scrypt hashing and salting; signed-token tamper/expiry; cookie parsing; rate limiter windows; every validator; **Gemini integration** with a mocked `fetch` (sanitisation, invented categories, timeouts/errors, key-in-header, injection text stays quoted); Copilot parsing of intents, dates, durations and deadlines |

### Running
```bash
npm test                    # everything
node --test test/api.test.js  # a single file
npm run test:coverage       # with coverage report
npm run lint                # syntax + unused imports (runs in CI too)
```

CI (`.github/workflows/ci.yml`) runs lint and tests on Node 20 and 22 for every push and pull request.

### Quality gates
`scripts/lint.mjs` (no dependencies) checks every file parses, flags unused imports, stray `debugger` statements and unresolved TODOs. Code is formatted with Prettier (`.prettierrc.json`, 110 columns).

---

## 9. Security

Full table in [SECURITY.md](SECURITY.md). Highlights:

- **Passwords:** scrypt with per-user salt and constant-time comparison; unknown emails are verified against a dummy hash so timing never reveals which accounts exist; generic error message.
- **Sessions:** HMAC-signed, expiring (8 h) token in an `HttpOnly; SameSite=Strict` cookie (`Secure` over HTTPS).
- **CSRF:** `SameSite=Strict` plus a required `X-Requested-With` header on every mutating request.
- **XSS:** the UI never uses `innerHTML` with data (a hyperscript helper inserts text nodes only); **strict CSP** (`script-src 'self'; style-src 'self'`, no inline scripts or styles), `frame-ancestors 'none'`, `nosniff`, no-referrer, COOP/CORP, HSTS over HTTPS.
- **Input validation:** every field is checked for type, range and length; JSON only; 64 KB body limit.
- **Abuse protection:** per-IP API limit (240/min), sign-in limits (30/10 min per IP, 8/10 min per account), registration (10/h), Copilot (30/min per user).
- **Authorisation:** role checks per route plus ownership and approver checks per resource; students never see other users' booking details; admins cannot demote or deactivate themselves.
- **Static files:** path-traversal safe; server source and config are never served.
- **LLM:** see [section 7](#7-ai-integration-gemini--local-engine).
- **Secrets and supply chain:** no secrets in the repo (`.env.example` only); **zero runtime dependencies** so there is no supply-chain surface.

---

## 10. Accessibility

- Skip link, semantic landmarks (`header`, `nav`, `main`), one `h1` per screen that receives focus on navigation, and a polite live region announcing results.
- Weekly calendar is fully **keyboard operable**: roving tab stop, arrow-key movement, Enter to pick a start and end, and every slot has a full spoken label (e.g. "Tue 24 Nov, 11 AM: booked, holder is flexible").
- Status is never colour-only: badges carry icons and text; calendar states use patterns and labels.
- Dialogs are real `role="dialog"` with `aria-modal`, **focus trap**, Escape to close and focus restoration; tabs implement arrow-key navigation; toasts use `role="status"` / `role="alert"`.
- Every form control has a visible label; errors are announced; progress and rings expose `role="progressbar"`/`img` with values; charts have text alternatives.
- Contrast-checked dark and light themes (persisted, default follows the OS), visible focus rings, `prefers-reduced-motion` honoured, `forced-colors` supported, responsive down to phone width.

---

## 11. Efficiency and code quality

- **Zero runtime dependencies**; no build step; the SPA ships as plain ES modules.
- Static files are read once, **gzip-compressed and ETag-cached in memory** (304 on revalidation).
- Availability, search and analytics are computed on demand from in-memory collections in milliseconds; the polling client refreshes counts once a minute and only while the tab is visible.
- Clear layering (routes → services → store), pure functions, small modules, JSDoc on non-obvious APIs, consistent formatting, shared helpers instead of copy-paste (`approvals.js`, `submitAction`, `validate.js`), and named constants instead of magic numbers.

---

## 12. API reference

All endpoints are JSON under `/api`. Mutating calls require the session cookie and the `X-Requested-With: lablink` header. Errors are `{ "error": "message", "details": { … } }` with status 400/401/403/404/409/413/415/422/429.

| Area | Endpoints |
|---|---|
| Auth & meta | `GET /meta` · `GET /auth/demo` · `POST /auth/login` · `POST /auth/register` · `POST /auth/logout` · `GET /auth/me` |
| Equipment | `GET /equipment` (`q`, `category`, `department`, `status`, `approval`, `available`, `sort`) · `GET /equipment/:id` · `GET /equipment/:id/availability` · `POST /equipment` _(admin)_ · `PATCH /equipment/:id` _(admin/custodian)_ · `DELETE /equipment/:id` _(admin)_ |
| Bookings | `GET /bookings` · `POST /bookings/check` (dry run + resolution) · `POST /bookings` · `POST /bookings/commit` (atomic multi-session) · `POST /bookings/plan` · `PATCH /bookings/:id` · `POST /bookings/:id/{cancel,check-in,complete,reschedule,decision}` · `GET /bookings/calendar.ics` |
| Waitlist & swaps | `GET/POST /waitlist` · `DELETE /waitlist/:id` · `GET/POST /swaps` · `POST /swaps/:id/respond` |
| Projects & access | `GET/POST /projects` · `PATCH /projects/:id` · `POST /projects/:id/members` · `DELETE /projects/:id/members/:userId` · `POST /projects/:id/recommend` · `GET/POST /access-requests` · `POST /access-requests/:id/decision` · `DELETE /access-requests/:id` · `GET /approvals` _(staff)_ |
| AI | `GET /ai/status` · `POST /ai/chat` |
| Insight | `GET /dashboard` · `GET /analytics/overview` _(staff)_ · `GET /notifications` · `POST /notifications/read-all` · `POST /notifications/:id/read` |
| Admin | `GET /admin/users` · `PATCH /admin/users/:id` · `GET /admin/audit` · `GET /faculty` |
| Ops | `GET /healthz` |

---

## 13. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port (Cloud Run sets `8080`) |
| `SESSION_SECRET` | random per start | Signs session cookies. **Set a long random value in production** |
| `GEMINI_API_KEY` | _(none)_ | Enables Gemini understanding and explanations |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini model name |
| `DEMO_MODE` | `true` | Set `false` to hide demo accounts |
| `DATA_FILE` | _(none)_ | Path for JSON persistence (atomic writes) |
| `CAMPUS_TZ` | `Asia/Kolkata` | Timezone for "today" and hours |
| `TRUST_PROXY` | auto on Cloud Run | Use `X-Forwarded-*` for client IP and HTTPS detection |

See `.env.example`.

---

## 14. Deployment

**Docker / Google Cloud Run** (recommended; single instance because data is in memory):
```bash
gcloud run deploy lablink --source . --region <region> --allow-unauthenticated \
  --max-instances 1 --set-env-vars SESSION_SECRET=<random>,GEMINI_API_KEY=<optional>
```
The `Dockerfile` uses `node:22-alpine`, runs as the unprivileged `node` user and includes a health check; there is no install step.

**Vercel** (current demo): `api/index.js` wraps the same handler as a serverless function and `vercel.json` serves `public/` statically. Set `SESSION_SECRET` as an environment variable.

---

## 15. Known limitations and future work

- Data is **in memory** (reseeded on start, optional JSON persistence). On serverless hosts it is per instance and resets on cold starts; production would use a database such as Firestore or PostgreSQL behind the `Store` interface.
- Authentication is email and password; a campus deployment would integrate SSO (SAML/OIDC).
- Notifications are in-app only; email or push delivery is a natural next step.
- Future work: recurring bookings, multi-unit equipment pools, richer swap negotiation (counter-offers), and learning booking durations from history to improve planning.
