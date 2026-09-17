# Deploy Sum

Sum can run on a container host with managed PostgreSQL or on a VPS using Compose. It has no dependency on a Mac, Tailscale, local credential files, or persistent application-container storage.

## Required configuration

| Variable             | Meaning                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL URL; use the provider's required TLS/CA settings                           |
| `SUM_ORIGIN`         | Exact public HTTPS origin, for example `https://sum.example.com`                      |
| `SUM_ENCRYPTION_KEY` | 64 hex characters from `openssl rand -hex 32`; keep stable across deploys             |
| `NODE_ENV`           | `production`                                                                          |
| `PORT` or `SUM_PORT` | Listener port, default 3003; `PORT` takes precedence                                  |
| `SUM_LINK_CLIENT_ID` | Optional registered Link device client ID; defaults to the upstream public CLI client |
| `SUM_TRUST_PROXY`    | `true` only when the service is reachable exclusively through a trusted proxy         |

Build the repository's Dockerfile and expose its configured port behind HTTPS. Route both the SPA and `/api` to the same service. Configure `/api/health` as the readiness check. The image runs migrations under a database lock before starting the server. It runs as the unprivileged `node` user. Give shutdown at least 45 seconds so an in-flight provider request can complete and sync state can be saved.

Use an **always-on container**, not a function that is suspended after returning an HTTP response. Import jobs continue inside the server process. A restart leaves saved pages intact; opening Sum or pressing Refresh resumes with idempotent upserts.

The included Compose configuration is a local/private default with loopback ports and development database credentials. A hosted service should inject its own `DATABASE_URL` and secrets directly into the image. For a VPS, replace the database credentials, keep PostgreSQL private, and put an HTTPS reverse proxy in front of the loopback app port. Do not publish the development database port publicly.

## Before public launch

1. Set the final HTTPS origin and verify Secure cookies and sign-in through that origin.
2. Complete a real Link approval, import, token refresh, sign-out/sign-in, and a second-user isolation check. The automated suite uses provider fixtures and cannot certify live bank coverage.
3. Confirm current Link device-client integration requirements for a publicly hosted application. The initial adapter uses the public client in Stripe's CLI; its SDK does not provide a hosted sign-in product or immutable subject ID. See the identity behavior in `ARCHITECTURE.md`.
4. Enable automated PostgreSQL backups and test restoration. Back up `SUM_ENCRYPTION_KEY` separately in the host's secret manager; database backups alone cannot recover encrypted Link tokens. Losing the key requires reconnecting Link accounts.
5. Decide whether access should remain open to any Link user who reaches the site. This is the current, requested behavior; no public signup allowlist or invitations are implemented.

The production dependency audit was clean during initial verification. Drizzle's development-only migration tooling still includes an advisory affecting its legacy esbuild development server; it is pruned from the production image and Sum does not run that server.

## Operating notes

The app logs sanitized route failures and HTTP metadata, not financial payloads or tokens. Sync failures appear in the user's workspace and `/api/v1/sync`. Load-balancer health checks should hit `/api/health`. Initial deployment should use one app replica; database locks already serialize per-user imports and token refreshes across replicas, but request rate limits are in-process, so a larger deployment should add shared edge rate limiting.

Scale PostgreSQL connections with care: one instance uses a normal pool of 10 plus three lock pools of up to 3 connections each. Use a direct/session-mode PostgreSQL connection for advisory locks, not transaction-mode pooling.
