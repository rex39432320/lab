# Security

| Area | Control |
|---|---|
| Passwords | scrypt with per-user salt, constant-time comparison; unknown users verify against a dummy hash so timing does not reveal accounts |
| Sessions | HMAC-signed, expiring token in an `HttpOnly; SameSite=Strict` cookie (`Secure` over HTTPS) |
| CSRF | `SameSite=Strict` plus a required `X-Requested-With` header on every mutating request |
| XSS | The UI builds DOM with text nodes only (no `innerHTML` with data); strict CSP (`script-src 'self'; style-src 'self'`, no inline code) |
| Input | Every body field validated by type, range and length; JSON only; 64 KB body limit (413) |
| Abuse | Per-IP API limit, per-IP and per-account sign-in limits, `Retry-After` headers |
| AuthZ | Role checks per route; ownership and approver checks per resource; students never see other users' booking details |
| Static files | Path-traversal safe; server source and config are never served |
| LLM | User text is passed as quoted data; output must match a constrained JSON shape and whitelisted categories; the API key is sent in a header and never logged |
| Secrets | None in the repo; configured through environment variables (`.env.example`) |
| Dependencies | None at runtime, so there is no supply-chain surface |

Demo accounts exist for evaluation. Set `DEMO_MODE=false` and a strong `SESSION_SECRET` in real deployments.
