import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Info,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  formatMoney,
  type Account,
  type AccountsResponse,
  type Filters,
  type LoginChallenge,
  type LoginStatus,
  type LinkInspection,
  type LinkResource,
  type SessionResponse,
  type SyncState,
  type Transaction,
  type TransactionsPage,
  type User,
} from '@sum/contracts';
import { api, post, HttpError } from './api';

const pretty = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const date = (value: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value.length === 10 ? `${value}T12:00:00` : value),
  );
function ago(value: string | null) {
  if (!value) return 'Not synced yet';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  return minutes < 1
    ? 'Just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}
function Logo() {
  return (
    <span className="wordmark">
      <span className="sum-mark" aria-hidden="true">
        <svg className="sum-symbol" viewBox="0 0 48 48" focusable="false">
          <path d="M6 4h35l3 12h-5l-3-7H17l17 15-17 15h19l3-7h5l-3 12H6v-4l19-16L6 8V4Z" />
        </svg>
      </span>
      SUM
    </span>
  );
}
function ErrorNote({ error }: { error: unknown }) {
  return (
    <div className="error-note" role="alert">
      {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
    </div>
  );
}
function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Loader2 className="spin" size={18} />
      {label}
    </div>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <span>{title}</span>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function LinkLogin({
  onDone,
  onClose,
  minimal = false,
}: {
  onDone: () => void;
  onClose?: () => void;
  minimal?: boolean;
}) {
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => post<LoginChallenge>('/auth/link/start'),
    onSuccess: (value) => {
      setProblem(null);
      setChallenge(value);
    },
  });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!challenge || problem) return;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() >= Date.parse(challenge.expiresAt)) {
        setProblem('This sign-in request expired. Start again when you’re ready.');
        return;
      }
      try {
        const result = await post<LoginStatus>('/auth/link/poll');
        if (stopped) return;
        if (result.status === 'authenticated') {
          doneRef.current();
          return;
        }
        if (result.status === 'denied' || result.status === 'expired') {
          setProblem(
            result.status === 'denied'
              ? 'The connection wasn’t approved. You can try again.'
              : 'This sign-in request expired. Please try again.',
          );
          return;
        }
        timeout = setTimeout(poll, (result.interval ?? challenge.interval) * 1000);
      } catch (error) {
        if (!stopped) setProblem(error instanceof Error ? error.message : 'Sign-in failed.');
      }
    };
    timeout = setTimeout(poll, challenge.interval * 1000);
    return () => {
      stopped = true;
      clearTimeout(timeout);
    };
  }, [challenge, problem]);
  return (
    <div className="login-content">
      {!minimal && (
        <>
          <p className="muted">Reconnect your Link account to resume syncing.</p>
        </>
      )}
      {challenge && !problem ? (
        <>
          <div className="verification">
            <span className="eyebrow">YOUR VERIFICATION PHRASE</span>
            <strong>{challenge.userCode}</strong>
            <span>Approve this phrase in Link to continue.</span>
          </div>
          <a
            className="button primary full"
            href={challenge.verificationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Link <ArrowUpRight size={17} />
          </a>
          <div className="waiting">
            <Loader2 size={14} className="spin" /> Waiting for your approval
          </div>
        </>
      ) : (
        <>
          {problem && <ErrorNote error={new Error(problem)} />}
          {start.error && <ErrorNote error={start.error} />}
          <button
            className="button primary full"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending && <Loader2 size={16} className="spin" />}
            {minimal ? 'Sign in with Link' : problem ? 'Try again with Link' : 'Continue with Link'}
            {!minimal && <ArrowRight size={17} />}
          </button>
        </>
      )}
      {onClose && (
        <button className="text-button" onClick={onClose}>
          Back to Sum
        </button>
      )}
    </div>
  );
}
function Welcome({ onDone }: { onDone: () => void }) {
  return (
    <div className="welcome welcome-minimal">
      <main className="welcome-minimal-main">
        <Logo />
        <section className="welcome-login">
          <LinkLogin minimal onDone={onDone} />
        </section>
      </main>
    </div>
  );
}
export function App() {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionResponse>('/session'),
    retry: false,
  });
  const onLogin = () => {
    queryClient.clear();
    void queryClient.invalidateQueries({ queryKey: ['session'] });
    window.location.assign('/');
  };
  if (session.isPending)
    return (
      <div className="boot">
        <Logo />
        <Spinner label="Loading" />
      </div>
    );
  if (session.error)
    return (
      <div className="boot">
        <Logo />
        <ErrorNote error={session.error} />
        <button className="button" onClick={() => void session.refetch()}>
          Try again
        </button>
      </div>
    );
  if (!session.data.user) return <Welcome onDone={onLogin} />;
  return <Workspace user={session.data.user} />;
}
function Workspace({ user }: { user: User }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [reconnect, setReconnect] = useState(false);
  const [waitingUntil, setWaitingUntil] = useState(0);
  const sync = useQuery({
    queryKey: ['sync', user.id],
    queryFn: () => api<SyncState>('/sync'),
    refetchInterval: (q) =>
      q.state.data?.status === 'running' || Date.now() < waitingUntil ? 1500 : 15000,
  });
  const accounts = useQuery({
    queryKey: ['accounts', user.id],
    queryFn: () => api<AccountsResponse>('/accounts'),
  });
  const refresh = useMutation({
    mutationFn: (force: boolean) => post('/sync', { force }),
    onMutate: () => {
      setWaitingUntil(Date.now() + 5000);
    },
    onSuccess: () => {
      void sync.refetch();
    },
  });
  const initialSync = useRef(false);
  useEffect(() => {
    if (!initialSync.current) {
      initialSync.current = true;
      refresh.mutate(false);
    }
  }, []);
  useEffect(() => {
    if (sync.data) {
      void client.invalidateQueries({ queryKey: ['accounts', user.id] });
      void client.invalidateQueries({ queryKey: ['transactions', user.id] });
      void client.invalidateQueries({ queryKey: ['filters', user.id] });
    }
  }, [sync.data?.completedAt, sync.data?.transactionsFetched]);
  useEffect(() => {
    if (sync.error instanceof HttpError && sync.error.status === 401) {
      client.clear();
      window.location.assign('/');
    }
  }, [sync.error]);
  const logout = useMutation({
    mutationFn: () => post('/auth/logout'),
    onSuccess: () => {
      client.clear();
      window.location.assign('/');
    },
  });
  const busy = refresh.isPending || sync.data?.status === 'running';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
        </div>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            Accounts
          </NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          <NavLink to="/connection">Connection</NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-menu">
            <span title={user.email}>{user.email}</span>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="sync-time">
            {busy
              ? `Syncing${sync.data?.transactionsFetched ? ` · ${sync.data.transactionsFetched} transactions` : ''}`
              : `Updated ${ago(sync.data?.lastSuccessAt ?? null)}`}
          </span>
          <div className="topbar-right">
            <button className="button small" onClick={() => refresh.mutate(true)} disabled={busy}>
              <RefreshCw size={13} className={busy ? 'spin' : ''} />
              {busy ? 'Syncing' : 'Refresh'}
            </button>
          </div>
        </header>
        <main className="main-content">
          {logout.error && <ErrorNote error={logout.error} />}
          {refresh.error && <ErrorNote error={refresh.error} />}
          {sync.error && <ErrorNote error={sync.error} />}
          {sync.data?.message && (
            <div className="notice">
              <span>{sync.data.message}</span>
              {sync.data.needsReconnect && (
                <button className="text-button" onClick={() => setReconnect(true)}>
                  Reconnect <ArrowUpRight size={13} />
                </button>
              )}
            </div>
          )}
          <Routes>
            <Route
              path="/"
              element={
                <AccountsView
                  response={accounts.data}
                  pending={accounts.isPending}
                  error={accounts.error}
                  onAccount={(id) => navigate(`/transactions?account=${encodeURIComponent(id)}`)}
                />
              }
            />
            <Route path="/transactions" element={<TransactionsView userId={user.id} />} />
            <Route
              path="/connection"
              element={
                <ConnectionView
                  user={user}
                  state={sync.data}
                  onReconnect={() => setReconnect(true)}
                />
              }
            />
            <Route
              path="*"
              element={
                <Empty title="Nothing at this address">
                  <NavLink to="/">Return to accounts</NavLink>
                </Empty>
              }
            />
          </Routes>
        </main>
      </div>
      {reconnect && (
        <Modal title="CONNECTION / LINK" onClose={() => setReconnect(false)}>
          <LinkLogin
            onClose={() => setReconnect(false)}
            onDone={() => {
              setReconnect(false);
              refresh.mutate(true);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
type Screen = 'accounts' | 'transactions' | 'connection';
const inspectable: Record<Screen, LinkResource[]> = {
  accounts: ['sources', 'balances'],
  transactions: ['transactions'],
  connection: [],
};
function DataInspector({ screen }: { screen: Screen }) {
  const [open, setOpen] = useState(false);
  const [resource, setResource] = useState<LinkResource | null>(null);
  const [result, setResult] = useState<LinkInspection | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  async function fetchRaw(nextResource: LinkResource, cursor?: string) {
    setLoading(true);
    setError(null);
    setResource(nextResource);
    setResult(null);
    try {
      const query = new URLSearchParams({ resource: nextResource });
      if (cursor) query.set('cursor', cursor);
      setResult(await api<LinkInspection>(`/link/inspect?${query}`));
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <button
        className="icon-button info-button"
        aria-label={`About ${screen} data`}
        onClick={() => setOpen(true)}
      >
        <Info size={17} />
      </button>
      {open && (
        <Modal title="Data sources" wide onClose={() => setOpen(false)}>
          <div className="inspector">
            {screen === 'accounts' && (
              <>
                <p>
                  Sum joins saved <code>GET /sources</code> and <code>GET /balances</code> data by
                  source ID. Each balance is a separate Link record. Account type tabs filter this
                  saved list in your browser.
                </p>
                <p>
                  Link requests: <code>limit=100</code>, then <code>starting_after</code> while{' '}
                  <code>has_more</code> is true. Sum stores selected fields and serves the complete
                  account list from its database. The account cards do not map to one Link call.
                </p>
                <div className="inspector-shapes">
                  <div>
                    <strong>Link request</strong>
                    <code>GET /sources?limit=100&amp;starting_after=id</code>
                    <code>GET /balances?limit=100&amp;starting_after=source_id</code>
                  </div>
                  <div>
                    <strong>Link response</strong>
                    <code>{'{ data: [{ id, name, type, ... }], has_more? }'}</code>
                    <code>
                      {'{ data: [{ source_id, type, current, currency, as_of, ... }], has_more? }'}
                    </code>
                  </div>
                  <div>
                    <strong>Sum response</strong>
                    <code>{'GET /accounts → { data: [{ id, name, balances: [...] }], sync }'}</code>
                  </div>
                </div>
              </>
            )}
            {screen === 'transactions' && (
              <>
                <p>
                  Sum imports <code>GET /transactions</code> pages from Link with{' '}
                  <code>limit=100</code> and <code>starting_after</code>. On the first import, it
                  also makes a recent pass with <code>start_date</code> for the last 30 days.
                </p>
                <p>
                  This table calls Sum’s <code>GET /transactions</code>. Search, account, category,
                  origin, and date filters run in Sum’s database. Sum sorts by date and ID, returns
                  50 rows per page, and supplies its own cursor. Load more requests the next Sum
                  page. The browser combines loaded pages. A row has no one-to-one Link call.
                </p>
                <div className="inspector-shapes">
                  <div>
                    <strong>Link request</strong>
                    <code>GET /transactions?limit=100&amp;starting_after=id</code>
                  </div>
                  <div>
                    <strong>Link response</strong>
                    <code>
                      {
                        '{ data: [{ id, source_id, created_date, description, amount, currency, category, origin, status }], has_more? }'
                      }
                    </code>
                  </div>
                  <div>
                    <strong>Sum request</strong>
                    <code>
                      GET
                      /transactions?q=&amp;account=&amp;category=&amp;origin=&amp;start=&amp;end=&amp;limit=50&amp;cursor=
                    </code>
                  </div>
                  <div>
                    <strong>Sum response</strong>
                    <code>{'{ data: Transaction[], nextCursor: string | null }'}</code>
                  </div>
                </div>
              </>
            )}
            {screen === 'connection' && (
              <p>
                Connection status and timestamps come from Sum’s <code>GET /sync</code> and its
                saved credential state; your email comes from <code>GET /session</code>. Refresh
                sends <code>POST /sync</code>, which starts the Link import described on the other
                screens. There is no single Link response for this screen.
              </p>
            )}
            {screen === 'connection' && (
              <div className="inspector-shapes">
                <div>
                  <strong>Sum response</strong>
                  <code>
                    {'GET /sync → { status, lastSuccessAt, historyComplete, needsReconnect, ... }'}
                  </code>
                </div>
              </div>
            )}
            {inspectable[screen].length > 0 && (
              <div className="inspector-raw">
                <p>
                  Fetch a fresh Link page to inspect its JSON. This is a new read, so it may differ
                  from the last saved sync. Sum returns the SDK-parsed response without applying its
                  account or transaction normalization.
                </p>
                <div className="inspector-actions">
                  {inspectable[screen].map((item) => (
                    <button
                      className="button small"
                      key={item}
                      disabled={loading}
                      onClick={() => void fetchRaw(item)}
                    >
                      Raw {item}
                    </button>
                  ))}
                </div>
                {error !== null && <ErrorNote error={error} />}
                {loading && <Spinner label="Fetching Link JSON" />}
                {result && (
                  <>
                    <div className="inspector-request">
                      <strong>Link request</strong>
                      <code>
                        {result.request.method} {result.request.path}?
                        {new URLSearchParams(
                          Object.entries(result.request.query).map(([key, value]) => [
                            key,
                            String(value),
                          ]),
                        ).toString()}
                      </code>
                      <span>Fetched {new Date(result.fetchedAt).toLocaleString()}</span>
                    </div>
                    <pre className="json-view">{JSON.stringify(result.response, null, 2)}</pre>
                    {result.nextCursor && resource && (
                      <button
                        className="button small"
                        disabled={loading}
                        onClick={() => void fetchRaw(resource, result.nextCursor!)}
                      >
                        Next Link page
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function PageHeading({ title, count, screen }: { title: string; count?: number; screen: Screen }) {
  return (
    <div className="page-heading">
      <h1>
        {title}
        {count !== undefined && (
          <>
            {' '}
            <span className="page-count">{count}</span>
          </>
        )}
      </h1>
      <DataInspector screen={screen} />
    </div>
  );
}
function AccountsView({
  response,
  pending,
  error,
  onAccount,
}: {
  response?: AccountsResponse;
  pending: boolean;
  error: unknown;
  onAccount: (id: string) => void;
}) {
  const all = response?.data ?? [];
  const active = all.filter((a) => a.active);
  const archived = all.filter((a) => !a.active);
  const [filter, setFilter] = useState('all');
  const shown =
    filter === 'all'
      ? active
      : active.filter((a) =>
          filter === 'credit'
            ? a.balances.some((b) => b.type === 'credit') || a.type === 'card'
            : a.type === 'bank_account',
        );
  return (
    <>
      <PageHeading title="Accounts" count={active.length} screen="accounts" />
      <div className="section-toolbar">
        <div className="segmented" aria-label="Account type">
          {[
            ['all', 'All'],
            ['cash', 'Bank'],
            ['credit', 'Credit'],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              className={filter === key ? 'selected' : ''}
              onClick={() => setFilter(key!)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <ErrorNote error={error} />
      ) : pending ? (
        <Spinner label="Reading accounts" />
      ) : !all.length ? (
        <div className="panel">
          <Empty title={response?.sync.status === 'running' ? 'Loading accounts' : 'No accounts'}>
            {response?.sync.status === 'running' ? (
              'Accounts will appear as Link returns them.'
            ) : (
              <>
                Manage accounts in Link, then refresh Sum.{' '}
                <a href="https://app.link.com" target="_blank" rel="noreferrer">
                  Open Link
                </a>
              </>
            )}
          </Empty>
        </div>
      ) : (
        <>
          <div className="account-grid">
            {shown.map((account) => (
              <button
                className="account-card"
                key={account.id}
                onClick={() => onAccount(account.id)}
              >
                <div className="account-card-head">
                  <h2>{account.name}</h2>
                  <ChevronRight size={16} />
                </div>
                {(account.institution || account.last4) && (
                  <div className="account-meta">
                    {account.institution && <span>{account.institution}</span>}
                    {account.last4 && <span>•• {account.last4}</span>}
                  </div>
                )}
                <div className="balance-block">
                  {account.balances.length ? (
                    account.balances.map((balance, i) => (
                      <div className="balance-currency" key={i}>
                        <div className="balance-main">
                          <strong className="balance-amount">
                            {formatMoney(balance.current.amount, balance.current.currency)}
                          </strong>
                          <span>{balance.current.currency.toUpperCase()}</span>
                        </div>
                        {balance.type === 'cash' &&
                          balance.available
                            .filter(
                              (money) =>
                                money.currency === balance.current.currency &&
                                money.amount !== balance.current.amount,
                            )
                            .map((money) => (
                              <div className="secondary-balance" key={money.currency}>
                                <span>Available</span>
                                <span>{formatMoney(money.amount, money.currency)}</span>
                              </div>
                            ))}
                        <span className="balance-time">Updated {ago(balance.asOf)}</span>
                      </div>
                    ))
                  ) : (
                    <span className="unavailable-balance">Balance unavailable</span>
                  )}
                </div>
                {account.connectionStatus &&
                  !['active', 'connected'].includes(account.connectionStatus) && (
                    <span className="account-warning">{pretty(account.connectionStatus)}</span>
                  )}
              </button>
            ))}
          </div>
          {!shown.length && <Empty title="No accounts in this view">Choose another type.</Empty>}
          {archived.length > 0 && (
            <details className="archived">
              <summary>
                {archived.length} previously connected{' '}
                {archived.length === 1 ? 'account' : 'accounts'}
              </summary>
              {archived.map((account) => (
                <button key={account.id} onClick={() => onAccount(account.id)}>
                  {account.name}
                  <ChevronRight size={13} />
                </button>
              ))}
            </details>
          )}
        </>
      )}
    </>
  );
}
function TransactionsView({ userId }: { userId: string }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Transaction | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !target?.closest('input, textarea, select, [contenteditable]')
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    setSearch(params.get('q') ?? '');
  }, [params.get('q')]);
  const filters = useQuery({
    queryKey: ['filters', userId],
    queryFn: () => api<Filters>('/filters'),
  });
  const query = params.toString();
  const data = useInfiniteQuery({
    queryKey: ['transactions', userId, query],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(query);
      p.set('limit', '50');
      if (pageParam) p.set('cursor', pageParam);
      return api<TransactionsPage>(`/transactions?${p}`);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const update = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  useEffect(() => {
    const id = setTimeout(() => {
      if (search !== (params.get('q') ?? '')) update('q', search);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);
  const rows = data.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <PageHeading title="Transactions" screen="transactions" />
      <div className="transactions-panel">
        <div className="transaction-controls">
          <label className="search-field">
            <Search size={16} />
            <input
              ref={searchInput}
              aria-label="Search transactions"
              placeholder="Search transactions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="filter-row">
          <label>
            <span>Account</span>
            <select
              aria-label="Account"
              value={params.get('account') ?? ''}
              onChange={(e) => update('account', e.target.value)}
            >
              <option value="">All accounts</option>
              {filters.data?.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
          <label>
            <span>Category</span>
            <select
              aria-label="Category"
              value={params.get('category') ?? ''}
              onChange={(e) => update('category', e.target.value)}
            >
              <option value="">All categories</option>
              {filters.data?.categories.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
              <option value="uncategorized">Uncategorized</option>
            </select>
          </label>
          <label>
            <span>Origin</span>
            <select
              aria-label="Origin"
              value={params.get('origin') ?? ''}
              onChange={(e) => update('origin', e.target.value)}
            >
              <option value="">All activity</option>
              <option value="external_connection">Bank connection</option>
              <option value="link">Link</option>
            </select>
          </label>
          <label className="date-filter">
            <span>From</span>
            <input
              type="date"
              aria-label="From date"
              value={params.get('start') ?? ''}
              onChange={(e) => update('start', e.target.value)}
            />
          </label>
          <label className="date-filter">
            <span>To</span>
            <input
              type="date"
              aria-label="To date"
              value={params.get('end') ?? ''}
              onChange={(e) => update('end', e.target.value)}
            />
          </label>
          {query && (
            <button
              className="icon-button clear-filters"
              aria-label="Clear filters"
              onClick={() => {
                setSearch('');
                setParams({});
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {filters.error && <ErrorNote error={filters.error} />}
        {data.error && <ErrorNote error={data.error} />}
        {data.isPending ? (
          <Spinner label="Reading transactions" />
        ) : !rows.length && !data.error ? (
          <Empty title={query ? 'No matching transactions' : 'No transactions'}>
            {query ? 'Change or clear the filters.' : 'Transactions will appear after syncing.'}
          </Empty>
        ) : (
          <>
            <div className="transaction-table-wrap">
              <table className="transaction-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Account</th>
                    <th>Category</th>
                    <th className="date-column" aria-sort="descending">
                      Date <span>↓</span>
                    </th>
                    <th className="amount-column">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>
                        <button
                          className="transaction-name"
                          onClick={() => setSelected(transaction)}
                        >
                          <span>
                            <strong>{transaction.description || 'Transaction'}</strong>
                            {!['succeeded', 'posted'].includes(transaction.status) && (
                              <small>{pretty(transaction.status)}</small>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="account-cell">{transaction.accountName ?? 'Unassigned'}</td>
                      <td>{transaction.category ? pretty(transaction.category) : '—'}</td>
                      <td className="date-column">{date(transaction.date)}</td>
                      <td className={`amount-column ${transaction.amount > 0 ? 'positive' : ''}`}>
                        {formatMoney(transaction.amount, transaction.currency, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>{rows.length} shown</span>
              {data.hasNextPage ? (
                <button
                  className="button small"
                  onClick={() => void data.fetchNextPage()}
                  disabled={data.isFetchingNextPage}
                >
                  {data.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
      {selected && (
        <Modal title="Transaction" onClose={() => setSelected(null)}>
          <div className="transaction-detail">
            <h2>{selected.description}</h2>
            <div className={`detail-amount ${selected.amount > 0 ? 'positive' : ''}`}>
              {formatMoney(selected.amount, selected.currency, true)}
            </div>
            <dl>
              {[
                ['Date', date(selected.date)],
                ['Account', selected.accountName ?? 'Unassigned'],
                ['Category', selected.category ? pretty(selected.category) : 'Uncategorized'],
                ['Status', pretty(selected.status)],
                ['Origin', selected.origin === 'link' ? 'Link' : 'Bank connection'],
                ['Currency', selected.currency],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Modal>
      )}
    </>
  );
}
function ConnectionView({
  user,
  state,
  onReconnect,
}: {
  user: User;
  state?: SyncState;
  onReconnect: () => void;
}) {
  return (
    <>
      <PageHeading title="Connection" screen="connection" />
      <section className="connection-card">
        <div className="connection-header">
          <h2>Link</h2>
          <span className={`connection-badge ${state?.needsReconnect ? 'attention' : ''}`}>
            {state?.needsReconnect ? 'Needs attention' : 'Connected'}
          </span>
        </div>
        <dl className="connection-facts">
          <div>
            <dt>Account</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>
              {state?.lastSuccessAt
                ? `${date(state.lastSuccessAt)} · ${ago(state.lastSuccessAt)}`
                : 'Not synced yet'}
            </dd>
          </div>
          <div>
            <dt>History</dt>
            <dd>{state?.historyComplete ? 'Imported' : 'Import pending'}</dd>
          </div>
        </dl>
        <div className="connection-actions">
          <button className="button" onClick={onReconnect}>
            Reconnect
          </button>
          <a className="button ghost" href="https://app.link.com" target="_blank" rel="noreferrer">
            Manage in Link <ArrowUpRight size={14} />
          </a>
        </div>
      </section>
    </>
  );
}
