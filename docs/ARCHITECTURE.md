# Architecture

Zero runtime dependencies: Node's `http`, `crypto`, `zlib` and `node:test`.

```
public/            Vanilla ES-module SPA (no build step)
  js/dom.js        XSS-safe hyperscript helper (text nodes only)
  js/views/*       One module per screen; components/ holds shared UI
server/
  app.js           Pipeline: security headers -> rate limit -> CSRF header -> auth -> role check -> handler
  routes/*         Thin HTTP layer: validate input, call services, shape output
  services/        Pure domain logic (testable without HTTP)
    scheduling.js  Slot arithmetic, availability, booking validation, quotas
    priority.js    Explainable fair-share score (0-100)
    resolver.js    Ranked conflict options: nearby slot, equivalent equipment, split, swap, waitlist
    planner.js     Spreads required hours before a deadline within quota
    bookings.js    Lifecycle: create, cancel, waitlist promotion, no-show release
    search.js      Offline semantic search with concept expansion
    ai.js          Optional Gemini client; validated output, silent fallback
    chat.js        Copilot intent parsing over the same services
    analytics.js   Utilisation, heatmap, insights
  store.js         In-memory store with atomic JSON persistence
api/index.js       Serverless entry (Vercel)
```

## Key decisions
- **Dates are `YYYY-MM-DD` strings and hours are numbers** in campus time, avoiding timezone bugs.
- **Priority is transparent.** `priority.js` returns the score and a per-factor breakdown that the UI shows to users.
- **Swaps are consent-based.** A holder can be asked to move; nothing changes without acceptance, and acceptance earns goodwill credit that raises future priority.
- **AI is an enhancement, not a dependency.** Every LLM call has a deterministic fallback, and model output is validated against a strict shape.
- **Atomic bulk booking.** Planner and alternative bookings are all-or-nothing with rollback.
