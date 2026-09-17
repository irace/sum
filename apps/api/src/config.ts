import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
export interface Config {
  databaseUrl: string;
  origin: string;
  encryptionKey: string;
  port: number;
  production: boolean;
  trustProxy: boolean;
}
export function getConfig(): Config {
  const encryptionKey = process.env.SUM_ENCRYPTION_KEY ?? '';
  if (!/^[a-f\d]{64}$/i.test(encryptionKey))
    throw new Error('SUM_ENCRYPTION_KEY must be 32 random bytes as 64 hex characters.');
  const origin = new URL(process.env.SUM_ORIGIN ?? 'http://localhost:3003').origin;
  return {
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://sum:sum@localhost:5434/sum',
    origin,
    encryptionKey,
    port: Number(process.env.PORT ?? process.env.SUM_PORT ?? 3003),
    production: process.env.NODE_ENV === 'production',
    trustProxy: process.env.SUM_TRUST_PROXY === 'true',
  };
}
