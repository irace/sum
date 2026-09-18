# Returning to Sum with Link without repeating financial consent

**Status:** Design proposal for Link and Sum; not implemented.

## Desired experience

The first time a person uses Sum, they sign in with Link and approve Sum's read-only financial access. Sum stores the resulting Link credential on its server. On another computer, the person selects **Sign in with Link**. Link establishes which Link account is present and returns a fresh proof of identity to Sum. Sum creates a session for that browser and uses the financial grant it already holds. Link does not ask the person to approve the same financial permissions again, and the sign-in does not replace or revoke Sum's stored financial refresh token.

This is a normal provider sign-in pattern. A new browser still needs to prove the user's identity; an existing server-side data grant cannot identify whoever opened that browser. The distinction is between **a new authentication event** and **a new grant of financial access**.

## Precedent from other providers

| Provider | Documented returning-user behavior | Relevance to Link |
| --- | --- | --- |
| Google | Google says its consent record is maintained per user and client ID, and consent is normally needed only the first time a new scope is requested. Its OpenID Connect flow issues an ID token for authentication; repeating consent is an explicit `prompt=consent` choice. [Consent persistence](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Sign in with Google](https://developers.google.com/identity/openid-connect/openid-connect) | Link can authenticate the user again while remembering the prior Sum grant and avoiding another financial consent screen. |
| GitHub | An OAuth app redirects the user to GitHub again to establish identity. GitHub says a previously authorized app can complete the web flow without showing the scope authorization page. One GitHub-specific detail: omitting scopes can cause a new token to inherit previously granted scopes; Link need not copy that token behavior to avoid repeat consent. [GitHub OAuth app web flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) | Repeating the provider redirect does not imply repeating the consent UI. Link should keep the identity-only token narrow even if its consent ledger remembers broader financial access. |
| X (formerly Twitter) | X's documented browser sign-in flow says that if the person is signed in to X and has already approved the app, X returns them to the app immediately. If they are signed in but have not approved it, X shows the permission request. This example is OAuth 1.0a, not a prescription for Link's protocol. [Log in with X](https://docs.x.com/fundamentals/authentication/guides/log-in-with-x) | The user experience of “authenticate again, consent only when needed” is established even outside OpenID Connect. |

OpenID Connect formalizes the identity side: an authentication request with `openid` returns an ID token containing a stable subject (`sub`) and an audience (`aud`) identifying the client. It is the cleanest standard model for Link to adopt if Link intends to serve as a sign-in provider for web apps. [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)

## What the client ID means

Link should register **Sum as an application** and give its production web service a stable client ID. Every browser and computer using that Sum deployment sends the same Sum client ID. Link associates the user's remembered consent with the Link user, the registered Sum client, and the permissions granted. The client ID identifies an app registration, not a particular computer or a particular Sum user. Google explicitly documents consent persistence per user and client ID. [Google consent model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)

The client ID is public; it is not proof that a request came from Sum. Link must also bind requests to Sum's registered redirect URI and, for a server-side web client, authenticate the client at the token endpoint using an appropriate server-held credential or equivalent mechanism. Authorization code with PKCE and transaction-bound `state`/`nonce` protects the sign-in exchange. OAuth defines the client ID as a non-secret identifier, and current OAuth security guidance calls for exact redirect matching and PKCE support. [OAuth 2.0 client registration](https://www.rfc-editor.org/rfc/rfc6749), [OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700)

Production Sum should have a registered production client ID and redirect URI. Staging and local development should normally use separate registrations, so test environments do not share a production consent identity. A single production client can serve many computers; no client ID per device is needed.

**Current migration issue:** Sum's adapter defaults to the public client ID used by Stripe's Link CLI unless `SUM_LINK_CLIENT_ID` is set ([adapter](../apps/api/src/link.ts), [deployment settings](deployment.md)). A display label of “Sum” does not turn that shared CLI ID into a Sum registration. A new Sum client ID should not be assumed to inherit consent or refresh tokens issued to the CLI client. Moving to a real Sum registration will likely require a one-time, clearly labeled connection under that client, unless Link provides an explicit, secure migration mechanism. After that transition, new-computer sign-ins should not ask for the financial grant again.

## Link capabilities required

### 1. A reliable identity assertion

Link should return a stable, never-reassigned Link user identifier for a completed sign-in. The preferred contract is an OpenID Connect ID token with `iss`, `sub`, `aud`, `exp`, `iat`, and a request-bound `nonce`, signed with a published verification key. Sum would key its user mapping by `(iss, sub)`. Email and name can be profile fields, but email must not be the account key: it can change. Google explicitly warns against using email as the unique account identifier and recommends `sub`. [Google ID token claims](https://developers.google.com/identity/openid-connect/openid-connect), [OpenID Connect subject definition](https://openid.net/specs/openid-connect-core-1_0.html)

The minimum viable Link change would be a stable subject returned by an authenticated `/userinfo` response, plus a short-lived identity-only access token. That could meet Sum's immediate need, but a signed OIDC ID token gives hosted clients a standard authentication contract and validation rules. Sum currently sees only nullable email through the SDK and keys users by normalized email ([current architecture](../ARCHITECTURE.md), [user schema](../packages/db/src/schema.ts)); this must change before subject-based sign-in is safe.

If Link uses pairwise subjects for privacy, the subject must remain stable for Sum's registration across devices and subsequent sign-ins. OpenID Connect allows either public or pairwise subject identifiers. [OpenID Connect subject types](https://openid.net/specs/openid-connect-core-1_0.html)

### 2. A web sign-in transaction that requests identity only

For a hosted web app, Link should support an authorization-code redirect flow (preferably OIDC) with registered HTTPS callbacks and PKCE. A returning Sum user could start a request conceptually like:

```text
GET https://login.link.com/authorize?
  response_type=code&
  client_id=<sum-production-client-id>&
  redirect_uri=https%3A%2F%2Fsum.example%2Fapi%2Fv1%2Fauth%2Flink%2Fcallback&
  scope=openid%20email&
  state=<one-time-browser-bound-value>&
  nonce=<one-time-value>&
  code_challenge=<S256-challenge>&
  code_challenge_method=S256
```

This request contains **no `source` authorization details**. The code exchange should return a fresh identity proof, and at most a short-lived identity-scoped access token if `/userinfo` is needed. It should not create, replace, rotate, or revoke the existing financial refresh grant. No long-lived identity refresh token is necessary for Sum's browser session model. Link may show its account picker, ask the user to sign in, or apply a risk-based challenge; those are authentication steps, not another request for source-data access. If the browser already has a suitable Link session, it can return promptly, as X documents for its returning-user browser flow. [X browser flow](https://docs.x.com/fundamentals/authentication/guides/log-in-with-x)

The current Link integration exposes a device-code flow, which gives the browser a verification URL and phrase ([adapter](../apps/api/src/link.ts), [architecture](../ARCHITECTURE.md)). Link could offer an identity-only variant of that flow as an interim measure, but the person may still need to approve the phrase for each new browser. A normal browser redirect is a better fit for the desired one-button sign-in experience.

### 3. Consent and token state kept distinct

Link needs a durable authorization record for each Link user and Sum client, including the scopes and structured source actions the user approved. That record must be distinct from Link's browser login session and from any one access or refresh token. The first Sum connection can request both identity and the four read-only source actions; a later identity-only sign-in can establish the same subject without changing the existing financial grant. Link should show a financial consent screen when Sum requests **new or expanded** actions, when consent was revoked or expired, or when policy requires a fresh authorization. Google describes this pattern as incremental authorization. [Google incremental authorization](https://developers.google.com/identity/oauth2/web/guides/use-token-model)

The scopes on the newly issued **identity-only token** should reflect that transaction, even though Link remembers a broader consent record. This is an intentional design choice. GitHub's OAuth app flow can inherit previously granted scopes when the request omits `scope`; that behavior demonstrates remembered consent, but it is broader than Sum needs for returning sign-in. [GitHub scope behavior](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)

Link should specify revocation semantics: signing out of Sum ends a Sum browser session; disconnecting Sum from Link revokes financial access; signing in again is possible even if financial access was revoked, after which Sum can offer a separate reconnect action. Identity-only sign-in must not silently reinstate a revoked financial grant.

## End-to-end flows

### First use

1. Sum starts Link sign-in using its registered client ID and requests identity plus the read-only source actions it needs.
2. Link authenticates the person and obtains consent for those financial actions. It records the grant for that Link user and Sum client.
3. Sum validates Link's identity assertion and stores `(issuer, subject) -> Sum user`.
4. Sum encrypts and stores the financial refresh token against that Sum user, then issues its own HttpOnly session cookie to the current browser.

Combining identity and financial access in this first interaction preserves a single onboarding flow. Google documents that sign-in can request other API scopes at the same time and that refresh tokens support continued server-side access. [Sign in with Google](https://developers.google.com/identity/openid-connect/openid-connect)

### Return on another computer

1. The new browser has no Sum session, so it selects **Sign in with Link**.
2. Sum starts an identity-only Link authorization request under the **same Sum client ID**. Link authenticates or recognizes the Link user. It does not ask for the previously granted source actions.
3. Link returns a one-time code to Sum's registered callback. Sum exchanges it server-side and validates the ID token, including signature, issuer, audience, expiry, nonce, and subject.
4. Sum looks up `(issuer, subject)`, issues a new Sum session for this browser, and uses the existing server-side financial credential for that user. It does **not** overwrite the financial credential with tokens from the sign-in exchange.
5. If the financial grant is no longer usable, Sum still knows who signed in. It can display cached data according to product policy and request a separate Link reconnection before syncing.

The original computer's Sum session remains independent. A new Sum session does not require a new Link financial grant.

### Expanded permissions or reconnection

When Sum adds a financial feature that needs a new source action, or the existing grant has been revoked or permanently expired, Sum starts a separate Link authorization request for the missing actions. The consent UI must describe the new access. On successful completion, Sum checks that the returned Link subject matches the currently signed-in Sum user before updating the stored financial credential. Sum already enforces a same-email check during today's reconnect flow; that should become a same-subject check ([current auth code](../apps/api/src/auth.ts)).

## Changes needed in Sum

1. Register a real Sum client with Link and configure its client ID, callback URL, and server-side client authentication. Stop using the shared CLI client for hosted Sum traffic.
2. Add an authorization-code callback flow with browser-bound `state`, PKCE, and OIDC `nonce`; validate the Link identity assertion on the server. Keep Link tokens out of the browser.
3. Add a stable Link issuer/subject identity key and migrate existing email-keyed users only after each user proves ownership of the old workspace and the Link subject. Do not automatically merge accounts by matching email alone.
4. Separate `sign in with Link` from `connect/reconnect financial access` in backend logic, even if the first-run UI combines them. A returning sign-in creates only a Sum session; financial credential updates happen only in an explicit connection flow.
5. Preserve existing read-only grants and per-browser Sum sessions. Define user-facing states for signed in with a valid grant, signed in with an expired/revoked grant, and a new Link user without a financial grant.

For the existing email-keyed installation, the straightforward migration is to ask a user with an active Sum session to authenticate with the new Link client, verify the resulting subject, and bind it to that already-authenticated Sum user. Users without an old Sum session need a deliberate recovery or a Link-provided verified migration assertion; matching the new subject to an old workspace on email alone would recreate the present identity weakness. The new registered client may also require one explicit financial connection because the old refresh token belongs to the shared CLI client.

## Acceptance checks for the Link contract

- Same Link user + same Sum client ID, on two unrelated browsers: the second browser can authenticate and Sum receives the same stable subject without a second source-permission prompt.
- A browser signed out of Link must authenticate with Link; Sum must never infer its identity from the stored financial token alone.
- Identity-only sign-in issues no financial-scoped token, leaves the existing financial refresh token usable, and does not restore revoked financial permissions.
- A different Link user signed in on the second browser yields a different subject and cannot enter the first user's Sum workspace, regardless of email changes or display names.
- New source actions require explicit consent; previously granted actions do not require a second consent solely because the user changed computers.
- The same Link subject survives Link email changes; a change of Sum client ID has an explicit migration path and is not silently treated as the same registered app.

## Decision requested from Link

The primary product request is: **support returning-user authentication for a registered web client without reauthorizing or disturbing that client's existing, server-held resource grant.** OIDC authorization code with PKCE, a stable subject, remembered consent per user/client, and a narrow identity-only transaction provide the most conventional contract. A device-flow-only variant could satisfy the permission requirement, but it would retain the approval-phrase experience on every new browser.
