# Sum

A personal finance app for accounts, balances, and transactions from Link. Dark mode, a quiet terminal-inspired interface, and a backend that owns financial behavior so future clients can stay small.

## Stack

Node.js 24, strict TypeScript, npm workspaces, Fastify, PostgreSQL + Drizzle, React + Vite, TanStack Query, React Router, shared Zod contracts, and Docker Compose. This follows Cove and Imprint's application architecture. Authentication is Link-only: Sum manages opaque browser sessions rather than adding password accounts.

## Run locally

```sh
cp .env.example .env
# Set SUM_ENCRYPTION_KEY to the output of: openssl rand -hex 32
npm ci
docker compose up -d db
npm run db:migrate
npm run build
node apps/api/dist/server.js
```

Open **http://localhost:3003** and select **Continue with Link**. Approve the phrase in Link, return to Sum, and the import starts automatically. Any Link user who can reach the app can sign in; their workspace and credentials are isolated from other users.

For hot reload, use `npm run dev` and open http://localhost:5175. Vite proxies API calls to Fastify on port 3003. Stop a production app on that port before starting the development API.

## Access from another computer

On the current Mac mini deployment, connect the other computer to the same Tailscale network and open **https://cerebro.reverse-locrian.ts.net:3003/**. Tailscale Serve terminates HTTPS and forwards to Sum on the loopback port. The app is configured with this exact `SUM_ORIGIN`, so Link sign-in uses secure, same-origin cookies.

The route was set with `tailscale serve --bg --https=3003 http://127.0.0.1:3003`. It stays private to the tailnet. A move to a public host requires updating `SUM_ORIGIN` to its final HTTPS domain and redeploying.

For the production container:

```sh
docker compose --profile production up -d --build app
```

The app listens on localhost:3003; PostgreSQL uses localhost:5434. Persistent app data lives in the `sum-postgres` Docker volume. The container runs migrations before starting and does not run as root. A local `.env` with a generated encryption key is not committed.

## Behavior

- Accounts show current balances, available cash or credit used, and the provider's balance timestamp. Missing balances remain unavailable rather than showing zero.
- Transactions support description search, account/category/origin/date filters, cursor pagination, and a detail dialog. Press `/` to focus search.
- On app open, sync runs when the last successful sync is more than 15 minutes old. Refresh explicitly requests a new sync. No scheduled bank polling runs while the app is closed.
- The first import fetches the last 30 days first, then all history exposed by Link. Subsequent refreshes reconcile all available pages; transactions upsert by user and provider ID. Link does not expose a documented change cursor, so Sum does not invent an incremental feed.
- Saved transactions remain available through provider outages and disconnected accounts. Full source lists can mark missing accounts inactive; partial lists cannot. A complete successful balance snapshot replaces the previous one. Failed balance retrieval preserves the old snapshot.
- Provider categories/statuses and Link/bank origins remain distinct. Sum does not infer transfers, deduplicate across origins by merchant/amount, aggregate currencies, or compute net worth.
- Reconnect Link from Connection if permissions or tokens expire. Sign out ends the current Sum session without deleting saved history or revoking the Link connection.

## Verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

PostgreSQL integration tests use a separate database and are skipped without `TEST_DATABASE_URL`:

```sh
docker compose exec -T db createdb -U sum sum_test
TEST_DATABASE_URL=postgres://sum:sum@localhost:5434/sum_test npm test
```

The suite refuses database names other than `sum_test`. It truncates test tables. Browser fixtures are intercepted only in Playwright; there is no production demo endpoint or fake financial data. A successful live Link sign-in and import remains a separate verification step requiring a user's approval.

See [architecture](ARCHITECTURE.md), [HTTP API](docs/api.md), and [deployment](docs/deployment.md).
