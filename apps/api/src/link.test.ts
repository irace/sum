import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLinkProvider, sourceActions } from './link.js';
afterEach(() => vi.unstubAllGlobals());
describe('Link authorization protocol', () => {
  it('requests only identity and the required financial read permissions', async () => {
    const request = vi.fn(async () =>
      Response.json({
        device_code: 'secret',
        user_code: 'phrase',
        verification_uri: 'https://app.link.com/verify',
        expires_in: 600,
        interval: 5,
      }),
    );
    vi.stubGlobal('fetch', request);
    await createLinkProvider().start();
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://login.link.com/device/code');
    const form = new URLSearchParams(options.body as URLSearchParams);
    expect(form.get('scope')).toBe('userinfo:read');
    expect(form.get('authorization_details[][type]')).toBe('source');
    expect(form.getAll('authorization_details[][actions][]')).toEqual(sourceActions);
    expect(form.toString()).not.toContain('payment_methods');
  });
  it('distinguishes polling delays, expiry, denial and pending approval', async () => {
    for (const [error, status] of [
      ['authorization_pending', 'pending'],
      ['slow_down', 'slow_down'],
      ['expired_token', 'expired'],
      ['access_denied', 'denied'],
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ error }, { status: 400 })),
      );
      expect(await createLinkProvider().poll('device-secret')).toBe(status);
    }
  });
  it('sanitizes provider errors and flags revoked refresh tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'invalid_grant', access_token: 'do-not-expose' }, { status: 400 }),
      ),
    );
    await expect(createLinkProvider().refresh('secret')).rejects.toMatchObject({
      status: 401,
      code: 'reconnect_required',
    });
    await expect(createLinkProvider().start()).rejects.not.toThrow('do-not-expose');
  });
  it('reads identity fields without requiring the full Link userinfo schema', async () => {
    const request = vi.fn(async () =>
      Response.json({
        email: 'alice@example.com',
        name: 'Alice',
        first_name: 'Alice',
        unexpected_provider_field: { nested: true },
      }),
    );
    vi.stubGlobal('fetch', request);
    await expect(createLinkProvider().retrieveIdentity('access-token')).resolves.toEqual({
      email: 'alice@example.com',
      name: 'Alice',
      first_name: 'Alice',
    });
    expect(request).toHaveBeenCalledWith(
      'https://api.link.com/userinfo',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token' },
      }),
    );
  });
});
