import Link, {
  LinkApiError,
  type Source,
  type Balance,
  type Transaction,
  type ListTransactionsParams,
  type UserInfo,
} from '@stripe/link-sdk';
import { z } from 'zod';
import { AppError, fingerprintToken } from './security.js';

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
export interface DeviceChallenge {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}
export interface Page<T> {
  data: T[];
  has_more?: boolean;
}
export interface FinancialClient {
  sources: { list(params?: { limit?: number; starting_after?: string }): Promise<Page<Source>> };
  balances: { list(params?: { limit?: number; starting_after?: string }): Promise<Page<Balance>> };
  transactions: { list(params?: ListTransactionsParams): Promise<Page<Transaction>> };
  userInfo: { retrieve(): Promise<UserInfo> };
}
export interface LinkProvider {
  start(): Promise<DeviceChallenge>;
  poll(code: string): Promise<Tokens | 'pending' | 'slow_down' | 'expired' | 'denied'>;
  refresh(token: string): Promise<Tokens>;
  revoke(token: string): Promise<void>;
  retrieveIdentity(accessToken: string): Promise<{
    email?: string | null;
    name?: string | null;
    first_name?: string | null;
  }>;
  client(getToken: (options?: { forceRefresh?: boolean }) => Promise<string>): FinancialClient;
}
const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});
const deviceSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.url(),
  verification_uri_complete: z.url().optional(),
  expires_in: z.number().positive(),
  interval: z.number().positive(),
});
// Public device client used by Stripe's Link CLI; this is not a secret.
export const sourceActions = [
  'read_source_details',
  'read_balances',
  'read_link_transactions',
  'read_external_transactions',
];
export function createLinkProvider(): LinkProvider {
  const clientId = process.env.SUM_LINK_CLIENT_ID ?? 'lwlpk_U7Qy7ThG69STZk';
  async function post(path: string, fields: URLSearchParams | Record<string, string>) {
    let response: Response;
    try {
      response = await fetch(`https://login.link.com/device/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new AppError(
        502,
        'Link is temporarily unreachable. Please try again.',
        'link_unavailable',
      );
    }
    const data: unknown = await response.json().catch(() => null);
    return { response, data };
  }
  return {
    async start() {
      const params = new URLSearchParams({
        client_id: clientId,
        scope: 'userinfo:read',
        connection_label: 'Sum',
        client_hint: 'Sum',
      });
      params.append('authorization_details[][type]', 'source');
      for (const action of sourceActions)
        params.append('authorization_details[][actions][]', action);
      const { response, data } = await post('code', params);
      if (!response.ok)
        throw new AppError(
          502,
          'Link could not start sign-in. Please try again.',
          'link_auth_failed',
        );
      return deviceSchema.parse(data);
    },
    async poll(code) {
      const { response, data } = await post('token', {
        client_id: clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code,
      });
      if (response.ok) return tokensSchema.parse(data);
      const error = z.object({ error: z.string() }).safeParse(data);
      switch (error.success ? error.data.error : '') {
        case 'authorization_pending':
          return 'pending';
        case 'slow_down':
          return 'slow_down';
        case 'expired_token':
          return 'expired';
        case 'access_denied':
        case 'authorization_failed':
          return 'denied';
        default:
          throw new AppError(
            502,
            'Link could not finish sign-in. Please try again.',
            'link_auth_failed',
          );
      }
    },
    async refresh(token) {
      const { response, data } = await post('token', {
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: token,
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 401)
          throw new AppError(401, 'Reconnect Link to resume syncing.', 'reconnect_required');
        throw new AppError(502, 'Link is temporarily unavailable.', 'link_unavailable');
      }
      return tokensSchema.parse(data);
    },
    async revoke(token) {
      const { response } = await post('revoke', { client_id: clientId, token });
      if (!response.ok)
        throw new AppError(502, 'Link could not disconnect. Please try again.', 'link_unavailable');
    },
    async retrieveIdentity(accessToken) {
      let response: Response;
      try {
        response = await fetch('https://api.link.com/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new AppError(
          502,
          'Link is temporarily unreachable. Please try again.',
          'link_unavailable',
        );
      }
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const providerHeaders: Record<string, string> = {};
        for (const name of [
          'content-type',
          'date',
          'server',
          'www-authenticate',
          'request-id',
          'x-request-id',
          'stripe-request-id',
          'cf-ray',
        ]) {
          const value = response.headers.get(name);
          if (value) providerHeaders[name] = value;
        }
        const providerError =
          data && typeof data === 'object'
            ? ['error', 'code']
                .map((key) => {
                  const value = (data as Record<string, unknown>)[key];
                  return typeof value === 'string' ? `${key}=${value.slice(0, 120)}` : null;
                })
                .filter((value): value is string => value !== null)
                .join(' ')
                .slice(0, 300) || undefined
            : undefined;
        const providerRequestId =
          response.headers.get('request-id') ??
          response.headers.get('x-request-id') ??
          response.headers.get('stripe-request-id') ??
          undefined;
        if (response.status === 401 || response.status === 403)
          throw new AppError(
            502,
            'Link approved the connection, but Sum could not read your Link identity. Please try again.',
            response.status === 401 ? 'link_identity_unauthorized' : 'link_identity_failed',
            {
              providerRequestId,
              providerStatus: response.status,
              providerHeaders,
              providerError,
              providerTokenFingerprint: fingerprintToken(accessToken),
            },
          );
        throw new AppError(
          502,
          'Link approved the connection, but Sum could not read your Link identity. Please try again.',
          'link_identity_failed',
          {
            providerRequestId,
            providerStatus: response.status,
            providerHeaders,
            providerError,
            providerTokenFingerprint: fingerprintToken(accessToken),
          },
        );
      }
      if (!data || typeof data !== 'object') return {};
      const value = data as Record<string, unknown>;
      return {
        email: typeof value.email === 'string' ? value.email : null,
        name: typeof value.name === 'string' ? value.name : null,
        first_name: typeof value.first_name === 'string' ? value.first_name : null,
      };
    },
    client(getToken) {
      return new Link({
        getAccessToken: getToken,
        fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
      });
    },
  };
}
export function isPermissionError(error: unknown) {
  return (
    (error instanceof LinkApiError && (error.status === 401 || error.status === 403)) ||
    (error instanceof AppError && error.code === 'reconnect_required')
  );
}
export function safeLinkError(error: unknown): string {
  if (isPermissionError(error)) return 'Reconnect Link to grant access and resume syncing.';
  if (error instanceof AppError) return error.message;
  if (error instanceof LinkApiError && error.status === 429)
    return 'Link is rate limiting requests. Please refresh again later.';
  return 'Some Link data could not be refreshed. Your previously saved data is still available.';
}
