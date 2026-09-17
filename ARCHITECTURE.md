# Sum architecture

```
Web client (React + Vite)
         │ HTTP / JSON, opaque session cookie
         ▼
Fastify API ──────────── Link SDK + device authorization
         │
         ▼
PostgreSQL (Drizzle)
```

`apps/api` owns authorization, credential refresh, provider normalization, sync, filtering, pagination, and all database access. `apps/web` renders API data and owns presentation state. `packages/contracts` defines query validation and wire types. `packages/db` owns schema, migrations, and connections. No Link token reaches the browser. No browser state is authoritative for a user's identity or financial data.

## Authentication

Sum implements the device authorization protocol used by the upstream Link CLI at `https://login.link.com/device/{code,token,revoke}`. The public client identifier and form serialization are isolated in the server's Link adapter. It requests `userinfo:read` and four read-only source actions: source details, balances, Link transactions, and external transactions. It never requests `payment_methods.agentic` or calls payment APIs.

The SDK does not implement login. Device challenge secrets and credentials are encrypted using AES-256-GCM with a deployment key. The browser receives a verification URL and phrase. A short-lived, HttpOnly cookie binds polling to the originating browser. The backend respects provider polling intervals, increases the interval on `slow_down`, and stops on denial or expiry.

On approval, the backend retrieves Link user info and creates a 30-day opaque session. Only its SHA-256 hash is stored. HTTPS deployments use Secure, HttpOnly, SameSite=Lax cookies. Mutations require a custom request header and enforce configured browser origin; CORS is not enabled. Session and authorization state live in PostgreSQL and survive container restarts.

**Identity limitation:** Link SDK 0.5.0 exposes a nullable email and no stable subject identifier through `userInfo`. Sum requires a valid email from that authenticated endpoint and uses its normalized value as the Link identity. Browser-supplied email is never accepted. Changing an email in Link creates a separate Sum workspace; there is no automatic merging. Reconnection while signed in must return the same identity. If Link supplies an immutable user identifier later, migrate identity keys before adding account-linking features. Public launch should verify the live identity behavior and current Link integration requirements.

Token refresh is serialized with PostgreSQL advisory locks; workers re-read credentials after acquiring the lock to honor rotating refresh tokens. The SDK retries a 401 once through this provider. Permanent authorization failures mark the connection for reconnection; transient failures retain cached data. Logs omit request bodies, cookies, authorization headers, and provider response bodies.

## Data and sync

All queries scope by the server-derived user ID. Account and transaction keys include that owner; source IDs are never globally unique in Sum. Financial amounts remain exact safe integer minor units. The UI uses currency-specific exponents. Dates are kept as provider calendar dates; balances retain their original `as_of` timestamps and distinct cash/credit semantics.

Imports upsert pages idempotently and persist progress. Partial imports remain visible and are labeled incomplete. Cursor loops, missing cursors, malformed values, and a 10,000-page safety limit stop a run without claiming completion. A retry starts from the beginning and reuses stored records. A completed history import means all history available through Link at that time, not a guarantee of all banking history.

Sync is triggered by clients, not a periodic scheduler. PostgreSQL locks allow only one sync per user across API instances. Separate bounded connection pools for sync, login, and token locks prevent lock holders from starving ordinary queries. Start with one always-on application instance; background work must be able to continue after the initiating HTTP response. Serverless request-only runtimes are not supported.

Only whitelisted account metadata is stored: source ID, label, type, institution if supplied, masked last four, capability/status fields, and granted actions. Full financial instrument details are never persisted. Transactions are retained rather than deleted when absent from a later provider response because no provider deletion contract is assumed.

## Future clients

The versioned HTTP API is independent of React and browser rendering. A native iOS client can consume the same accounts, transactions, filters, and sync semantics. Native token issuance/secure device storage is intentionally deferred; no finance rules need to move out of React because they already live on the server.

## Upstream references

- https://github.com/stripe/link-cli
- https://github.com/stripe/link-cli/blob/main/skills/financial-insights/SKILL.md
- https://github.com/stripe/link-cli/tree/main/packages/sdk
- https://github.com/stripe/link-cli/tree/main/packages/cli/src/auth
