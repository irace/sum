import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { transactionQuery } from '@sum/contracts';
import type { Database } from '@sum/db';
import type { Config } from './config.js';
import { createAuth } from './auth.js';
import { createCatalog } from './catalog.js';
import { createSync } from './sync.js';
import { createLinkProvider, safeLinkError, type LinkProvider } from './link.js';
import { AppError } from './security.js';

export async function createApp(
  database: Database,
  config: Config,
  provider: LinkProvider = createLinkProvider(),
) {
  const app = Fastify({
    logger: config.production
      ? {
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url?.split('?')[0],
              remoteAddress: req.ip,
            }),
          },
        }
      : false,
    trustProxy: config.trustProxy,
    bodyLimit: 16_384,
  });
  const auth = createAuth(database, config, provider);
  const catalog = createCatalog(database);
  const sync = createSync(database, auth);
  await app.register(cookie);
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  await app.register(compress);
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    if (config.production)
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    if (config.origin.startsWith('https:'))
      reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (request.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      // Browser API writes require an explicit same-origin header. Native auth can be added independently later.
      if (request.headers['x-sum-client'] !== 'web')
        throw new AppError(403, 'Missing request protection header.', 'invalid_origin');
      const allowed = new Set([config.origin]);
      if (!config.production) allowed.add('http://localhost:5175').add('http://127.0.0.1:5175');
      if (request.headers.origin && !allowed.has(request.headers.origin))
        throw new AppError(403, 'This origin is not allowed.', 'invalid_origin');
      if (request.headers['sec-fetch-site'] === 'cross-site')
        throw new AppError(403, 'Cross-site requests are not allowed.', 'invalid_origin');
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn(
        {
          event: 'request_failed',
          route: request.routeOptions.url,
          errorCode: error.code,
          providerStatus: error.meta?.providerStatus ?? error.status,
          providerRequestId: error.meta?.providerRequestId,
          providerHeaders: error.meta?.providerHeaders,
          providerError: error.meta?.providerError,
          providerTokenFingerprint: error.meta?.providerTokenFingerprint,
          identityRetried: error.meta?.identityRetried,
        },
        'Request failed',
      );
      return reply.code(error.status).send({ error: error.message, code: error.code });
    }
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: error.issues[0]?.message ?? 'Invalid request.', code: 'invalid_request' });
    const status =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status === 429)
      return reply
        .code(429)
        .send({ error: 'Too many requests. Please try again shortly.', code: 'rate_limited' });
    // Do not log provider exceptions, which may contain tokens or raw financial responses.
    request.log.error(
      {
        event: 'request_failed',
        route: request.routeOptions.url,
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode:
          typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined,
        providerStatus:
          typeof error === 'object' && error && 'status' in error
            ? Number(error.status)
            : undefined,
      },
      'Request failed',
    );
    return reply.code(status >= 400 && status < 500 ? status : 500).send({
      error:
        status >= 400 && status < 500
          ? 'Invalid request.'
          : 'Something went wrong. Please try again.',
      code: 'request_failed',
    });
  });
  app.get('/api/health', async () => {
    await database.pool.query('SELECT 1');
    return { status: 'ok' };
  });
  app.get('/api/v1/session', async (request) => {
    const user = await auth.currentUser(request);
    return { user: user ? { id: user.id, email: user.email, name: user.name } : null };
  });
  app.post(
    '/api/v1/auth/link/start',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    (request, reply) => auth.start(request, reply),
  );
  app.post('/api/v1/auth/link/poll', (request, reply) => auth.poll(request, reply));
  app.post('/api/v1/auth/logout', (request, reply) => auth.logout(request, reply));
  app.get('/api/v1/accounts', async (request) => {
    const user = await auth.requireUser(request);
    return { data: await catalog.accounts(user.id), sync: await sync.state(user.id) };
  });
  app.get('/api/v1/transactions', async (request) => {
    const user = await auth.requireUser(request);
    return catalog.transactions(user.id, transactionQuery.parse(request.query));
  });
  app.get('/api/v1/filters', async (request) => {
    const user = await auth.requireUser(request);
    return catalog.filters(user.id);
  });
  app.get('/api/v1/sync', async (request) => {
    const user = await auth.requireUser(request);
    return sync.state(user.id);
  });
  app.get(
    '/api/v1/link/inspect',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const user = await auth.requireUser(request);
      const { resource, cursor, start } = z
        .object({
          resource: z.enum(['sources', 'balances', 'transactions']),
          cursor: z.string().min(1).max(200).optional(),
          start: z.iso.date().optional(),
        })
        .parse(request.query);
      if (start && resource !== 'transactions')
        throw new AppError(400, 'A start date applies only to transactions.', 'invalid_request');
      const params = { limit: 100, starting_after: cursor };
      const client = auth.client(user.id);
      try {
        const response =
          resource === 'sources'
            ? await client.sources.list(params)
            : resource === 'balances'
              ? await client.balances.list(params)
              : await client.transactions.list({
                  ...params,
                  ...(start ? { start_date: start } : {}),
                });
        const last = response.data.at(-1);
        const nextCursor =
          response.has_more && last ? (resource === 'balances' ? last.source_id : last.id) : null;
        const query = {
          limit: 100,
          ...(start ? { start_date: start } : {}),
          ...(cursor ? { starting_after: cursor } : {}),
        };
        return {
          request: { method: 'GET', path: `/${resource}`, query },
          response,
          nextCursor,
          fetchedAt: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(502, safeLinkError(error), 'link_inspection_failed');
      }
    },
  );
  app.post(
    '/api/v1/sync',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await auth.requireUser(request);
      const { force } = z.object({ force: z.boolean().default(false) }).parse(request.body ?? {});
      void sync.start(user.id, force);
      return reply.code(202).send({ accepted: true });
    },
  );
  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(webRoot)) {
    await app.register(staticFiles, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith('/api') ||
        request.method !== 'GET' ||
        request.url.startsWith('/assets/')
      )
        return reply.code(404).send({ error: 'Not found.' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => {
    await sync.stop();
  });
  return { app, auth, sync, catalog };
}
