import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export const opaqueToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function seal(value: unknown, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
}
export function unseal<T>(value: string, key: string): T {
  const [iv, tag, encrypted] = value.split('.').map((s) => Buffer.from(s, 'base64url'));
  if (!iv || !tag || !encrypted) throw new Error('Invalid encrypted credential.');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8'),
  ) as T;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'request_failed',
    public meta?: {
      providerRequestId?: string;
      providerStatus?: number;
      identityRetried?: boolean;
    },
  ) {
    super(message);
  }
}
