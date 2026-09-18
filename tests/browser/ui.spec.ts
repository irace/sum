import { expect, test, type Page } from '@playwright/test';
const sync = {
  status: 'succeeded',
  lastSuccessAt: '2026-09-16T20:30:00Z',
  startedAt: '2026-09-16T20:29:00Z',
  completedAt: '2026-09-16T20:30:00Z',
  transactionsFetched: 1264,
  message: null,
  needsReconnect: false,
  historyComplete: true,
};
const names = [
  'Everyday Checking',
  'High-Yield Savings',
  'Sapphire Preferred',
  'Apple Card',
  'Joint Checking',
  'Travel Fund',
];
const amounts = [824530, 3245087, 184260, 42719, 365022, 612500];
const accounts = names.map((name, i) => ({
  id: `a${i}`,
  name,
  type: [2, 3].includes(i) ? 'card' : 'bank_account',
  institution: [
    'Chase',
    'Marcus by Goldman Sachs',
    'Chase',
    'Goldman Sachs',
    'Ally Bank',
    'Capital One',
  ][i],
  last4: ['4821', '9012', '7643', '0891', '3356', '1209'][i],
  connectionStatus: 'active',
  capabilities: {},
  grantedActions: [],
  active: true,
  fetchedAt: sync.completedAt,
  balances: [
    {
      type: [2, 3].includes(i) ? 'credit' : 'cash',
      current: { amount: amounts[i], currency: 'USD' },
      available: [2, 3].includes(i) ? [] : [{ amount: amounts[i]! - 23000, currency: 'USD' }],
      used: [2, 3].includes(i) ? [{ amount: amounts[i], currency: 'USD' }] : [],
      asOf: sync.completedAt,
    },
  ],
}));
const transactions = [
  'Whole Foods Market',
  'Payroll · Acme Inc.',
  'Blue Bottle Coffee',
  'Apple',
  'Trader Joe’s',
  'Con Edison',
  'Sweetgreen',
  'Spotify',
  'Transfer to savings',
  'Bookshop.org',
].map((description, i) => ({
  id: `t${i}`,
  accountId: `a${i % 6}`,
  accountName: names[i % 6],
  date: '2026-09-16',
  description,
  amount: i === 1 ? 482500 : -[8642, 0, 650, 2999, 7284, 14120, 1675, 1199, 50000, 3295][i]!,
  currency: 'USD',
  category: [
    'groceries',
    'income',
    'food_and_drink',
    'shopping',
    'groceries',
    'utilities',
    'food_and_drink',
    'entertainment',
    'transfer',
    'shopping',
  ][i],
  origin: 'external_connection',
  status: 'succeeded',
}));
async function mock(page: Page, signedIn = true) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown;
    if (path.endsWith('/session'))
      body = { user: signedIn ? { id: 'u1', email: 'alex@example.com', name: 'Alex' } : null };
    else if (path.endsWith('/accounts')) body = { data: accounts, sync };
    else if (path.endsWith('/sync'))
      body = route.request().method() === 'POST' ? { accepted: true } : sync;
    else if (path.endsWith('/filters'))
      body = {
        accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
        categories: ['groceries', 'shopping', 'income'],
      };
    else if (path.endsWith('/link/inspect')) {
      const resource = url.searchParams.get('resource');
      body = {
        request: { method: 'GET', path: `/${resource}`, query: { limit: 100 } },
        response: { data: [{ id: 'raw-link-source', name: 'Everyday Checking' }], has_more: false },
        nextCursor: null,
        fetchedAt: '2026-09-16T20:30:00Z',
      };
    } else if (path.endsWith('/transactions')) {
      const q = url.searchParams.get('q')?.toLowerCase() ?? '';
      const account = url.searchParams.get('account');
      body = {
        data: transactions.filter(
          (t) => t.description.toLowerCase().includes(q) && (!account || t.accountId === account),
        ),
        nextCursor: null,
      };
    } else if (path.endsWith('/auth/link/start'))
      body = {
        verificationUrl: 'https://app.link.com/verify',
        userCode: 'moss-lake-river',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        interval: 5,
      };
    else if (path.endsWith('/auth/link/poll')) body = { status: 'pending', interval: 5 };
    else body = { ok: true };
    await route.fulfill({ json: body });
  });
}
test('desktop accounts, navigation, filters and transaction detail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await mock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Accounts 6' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Everyday Checking' })).toBeVisible();
  await expect(page.getByText('$8,245.30', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/accounts-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'About accounts data' }).click();
  await expect(
    page.getByRole('dialog').getByText('GET /sources?limit=100&starting_after=id'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Raw sources' }).click();
  await expect(page.getByRole('dialog').getByText(/raw-link-source/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Credit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Everyday Checking' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Whole Foods Market', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/transactions-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Whole Foods Market', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('-$86.42', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search transactions' }).fill('coffee');
  await expect(page.getByRole('button', { name: 'Blue Bottle Coffee', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Whole Foods Market', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('button', { name: 'Whole Foods Market', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Connection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Link' })).toBeVisible();
  await page.getByRole('button', { name: 'About connection data' }).click();
  await expect(
    page.getByRole('dialog').getByText(/There is no single Link response/),
  ).toBeVisible();
});
test('phone layouts do not overflow and account links filter activity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Everyday Checking' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/accounts-mobile.png', fullPage: true });
  await page.getByRole('button', { name: /Everyday Checking/ }).click();
  await expect(page.getByRole('combobox', { name: 'Account', exact: true })).toHaveValue('a0');
  await page.screenshot({ path: 'test-results/transactions-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('Link sign-in displays the returned approval phrase', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, false);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in with Link' })).toBeVisible();
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign in with Link' }).click();
  await expect(page.getByText('moss-lake-river')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Link' })).toHaveAttribute(
    'href',
    'https://app.link.com/verify',
  );
});
