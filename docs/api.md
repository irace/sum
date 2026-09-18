# HTTP API

All financial endpoints require a Sum session and derive the owner from it. Responses use JSON, errors use `{ error, code }`, and authenticated data is marked `Cache-Control: no-store`. Browser mutations send `X-Sum-Client: web` and same-origin credentials.

| Method | Path                      | Behavior                                                                      |
| ------ | ------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/health`             | Database-backed readiness check; no private data                              |
| GET    | `/api/v1/session`         | Current `{ user }` or `{ user: null }`                                        |
| POST   | `/api/v1/auth/link/start` | Begin device approval; returns verification URL, phrase, expiry and interval  |
| POST   | `/api/v1/auth/link/poll`  | Poll the browser-bound approval; returns pending/authenticated/expired/denied |
| POST   | `/api/v1/auth/logout`     | Invalidate current browser session and pending login                          |
| GET    | `/api/v1/accounts`        | Normalized account list, balance snapshots, and sync state                    |
| GET    | `/api/v1/transactions`    | Filtered, newest-first transaction page                                       |
| GET    | `/api/v1/filters`         | The user's account choices and provider categories                            |
| GET    | `/api/v1/sync`            | Persisted sync status, timestamps, progress, and reconnection state           |
| GET    | `/api/v1/link/inspect`    | Fetch one fresh Link SDK response page for the signed-in user                 |
| POST   | `/api/v1/sync`            | `{ force: boolean }`; accepts a sync request with 202                         |

Transactions accept `q`, `account`, `category`, `origin` (`link` or `external_connection`), `start`/`end` inclusive YYYY-MM-DD dates, `limit` (1–100; default 50), and an opaque `cursor`. Use `account=unassigned` for null source IDs or `category=uncategorized` for null or explicitly uncategorized categories. Results sort by date descending and then provider ID descending for deterministic pagination. Return shape: `{ data, nextCursor }`.

Accounts return original source identifiers to support filtering but never full account numbers. Balances contain separate current, available, and credit-used fields with currency codes. Transactions expose source description, status, category, origin, signed integer amount, and currency. Shared TypeScript contracts are in `packages/contracts/src/index.ts`.

Sign out leaves imported data and the provider grant intact. Native authentication is not implemented yet; the data routes and services are client-independent.

`/api/v1/link/inspect` accepts `resource=sources|balances|transactions`, optional `cursor`, and optional transaction `start` date. It makes a new Link read with `limit=100` and returns `{ request, response, nextCursor, fetchedAt }`. `response` is the SDK-parsed Link JSON, before Sum normalization. `nextCursor` follows Link's `has_more` and `starting_after` convention. It is rate limited to 20 requests per minute, requires the user's session, and never returns credentials. It may differ from the last saved sync because it fetches live data.
