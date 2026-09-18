import { z } from 'zod';

export const transactionQuery = z
  .object({
    q: z.string().trim().max(200).default(''),
    account: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
    origin: z.enum(['link', 'external_connection']).optional(),
    start: z.iso.date().optional(),
    end: z.iso.date().optional(),
    cursor: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => !v.start || !v.end || v.start <= v.end, {
    message: 'Start date must be on or before end date.',
  });
export type TransactionQuery = z.infer<typeof transactionQuery>;
export interface User {
  id: string;
  email: string;
  name: string | null;
}
export interface Money {
  amount: number;
  currency: string;
}
export interface Account {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  last4: string | null;
  connectionStatus: string | null;
  capabilities: Record<string, string>;
  grantedActions: string[];
  active: boolean;
  fetchedAt: string;
  balances: {
    type: 'cash' | 'credit';
    current: Money;
    available: Money[];
    used: Money[];
    asOf: string;
  }[];
}
export interface Transaction {
  id: string;
  accountId: string | null;
  accountName: string | null;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category: string | null;
  origin: 'link' | 'external_connection';
  status: string;
}
export interface TransactionsPage {
  data: Transaction[];
  nextCursor: string | null;
}
export interface SyncState {
  status: 'idle' | 'running' | 'succeeded' | 'partial' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  lastSuccessAt: string | null;
  transactionsFetched: number;
  message: string | null;
  needsReconnect: boolean;
  historyComplete: boolean;
}
export interface AccountsResponse {
  data: Account[];
  sync: SyncState;
}
export interface SessionResponse {
  user: User | null;
}
export interface LoginChallenge {
  verificationUrl: string;
  userCode: string;
  expiresAt: string;
  interval: number;
}
export interface LoginStatus {
  status: 'pending' | 'authenticated' | 'expired' | 'denied';
  interval?: number;
}
export interface Filters {
  accounts: { id: string; name: string }[];
  categories: string[];
}
export type LinkResource = 'sources' | 'balances' | 'transactions';
export interface LinkInspection {
  request: {
    method: 'GET';
    path: string;
    query: Record<string, string | number>;
  };
  response: { data: unknown[]; has_more?: boolean; [key: string]: unknown };
  nextCursor: string | null;
  fetchedAt: string;
}
export interface ApiError {
  error: string;
  code?: string;
}

export function formatMoney(amount: number, currency: string, signed = false): string {
  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** exponent);
  } catch {
    return `${amount} ${currency.toUpperCase()} (minor units)`;
  }
}
