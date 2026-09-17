# Link authentication debug trace

This is a redacted trace for diagnosing Sum's Link device authorization flow. No access tokens, refresh tokens, cookies, device codes, user codes, or provider response bodies are included.

## Request sequence

1. The browser sends `POST /api/v1/auth/link/start` with `X-Sum-Client: web` and same-origin credentials.
2. Sum creates an `auth_flows` row containing a hash of a browser cookie and an encrypted Link device code. The plaintext device code is never returned to the browser.
3. Sum sends `POST https://login.link.com/device/code` as an URL-encoded form with:
   - `client_id=lwlpk_U7Qy7ThG69STZk` (the public Link device client ID)
   - `scope=userinfo:read`
   - `connection_label=Sum`
   - `client_hint=Sum`
   - `authorization_details[][type]=source`
   - `authorization_details[][actions][]=read_source_details`
   - `authorization_details[][actions][]=read_balances`
   - `authorization_details[][actions][]=read_link_transactions`
   - `authorization_details[][actions][]=read_external_transactions`
4. Sum returns HTTP 200 with a verification URL, user code, expiry, and polling interval. The device code is omitted from the response.
5. The browser sends `POST /api/v1/auth/link/poll` with the HttpOnly flow cookie. Sum enforces the provider interval and sends `POST https://login.link.com/device/token` with `client_id`, the device-code grant type, and the encrypted device code.
6. Before approval, Link returns `authorization_pending`; Sum returns HTTP 200 `{status:"pending", interval:...}`. A `slow_down` response increases the stored interval by five seconds. Expiry and denial delete the flow and clear the cookie.
7. After approval, Link returns an access token, refresh token, and expiry. Sum then requests identity from `GET https://api.link.com/userinfo` with `Authorization: Bearer <access token>`.
8. If identity succeeds and contains a valid email, Sum transactionally upserts `users`, upserts encrypted `credentials`, creates a 30-day opaque `sessions` row, deletes the `auth_flows` row, sets the session cookie, and returns HTTP 200 `{status:"authenticated"}`.

## Observed responses

The first two attempts produced this sequence in production:

| Step | Response |
| --- | --- |
| `/api/v1/auth/link/start` | HTTP 200 |
| Poll 1 | HTTP 200, `status:"pending"` |
| Poll 2 | HTTP 200, `status:"pending"` |
| Poll after Link approval | HTTP 500, `{error:"Something went wrong. Please try again.", code:"request_failed"}` |

The final approved poll took approximately 795 ms, indicating the failure happened after token issuance during identity lookup or workspace creation.

After two failed attempts, the database counts were:

```text
users=0, auth_flows=2, sessions=0, credentials=0
```

That proves no Sum user, Link credential, or browser session was created by either attempt.

After the identity error mapping was deployed, the approved poll returned HTTP 502:

```json
{
  "error": "Link approved the connection, but Sum could not read your Link identity. Please try again.",
  "code": "link_identity_failed"
}
```

The current source distinguishes HTTP 401 as `link_identity_unauthorized`, refreshes once with `POST https://login.link.com/device/token` using the refresh-token grant, and retries `/userinfo`. HTTP 403 and other non-2xx responses do not retry. AppError logs now record only the route, Link's upstream provider status, error code, whether an identity retry occurred, and (when supplied) Link's request ID; cookies, authorization headers, bodies, and tokens remain redacted.

## What remains unknown

The production log line containing `providerStatus` will distinguish the three materially different cases:

- `401`: token rotation, audience, or immediate-token validity issue; the refresh retry is relevant.
- `403`: missing/insufficient Link authorization; refresh will not change permissions.
- Other status: Link API availability or endpoint behavior; refresh is not the root fix.

To capture the latest redacted lines on the Mac mini:

```sh
cd /Users/bryan/dev/sum
docker compose --profile production logs --timestamps --tail=240 app
```

For a live attempt, start `docker compose --profile production logs --timestamps -f app`, complete one Link approval, then stop the log stream. The relevant completion lines contain `route`, `errorCode`, and `providerStatus` without credentials.
