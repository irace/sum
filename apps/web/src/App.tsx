import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Database,
  Landmark,
  Layers2,
  Link2,
  ListFilter,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Wallet,
  X,
} from 'lucide-react';
import {
  formatMoney,
  type Account,
  type AccountsResponse,
  type Filters,
  type LoginChallenge,
  type LoginStatus,
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
        ∑
      </span>
      sum<span className="wordmark-dot">.</span>
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
      <span className="terminal-cursor">_</span>
    </div>
  );
}
function Empty({
  title,
  children,
  icon = <Layers2 size={25} />,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
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
      className="modal"
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
function LinkLogin({ onDone, onClose }: { onDone: () => void; onClose?: () => void }) {
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
      <div className="integration-icon">
        <Link2 size={28} />
      </div>
      <p className="eyebrow">A CLEARER CONNECTION</p>
      <h2>{challenge && !problem ? 'One quick approval.' : 'Your money, in view.'}</h2>
      <p className="muted">
        Connect your Link account to bring your accounts, balances, and transactions into Sum.
      </p>
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
            {start.isPending ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}{' '}
            {problem ? 'Try again with Link' : 'Continue with Link'}
            <ArrowRight size={17} />
          </button>
        </>
      )}
      <div className="permission-note">
        <ShieldCheck size={16} />
        <span>Read-only access. Sum can’t move your money.</span>
      </div>
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
    <div className="welcome">
      <header className="welcome-header">
        <Logo />
        <span className="eyebrow">PERSONAL FINANCE, SIMPLIFIED</span>
        <a href="https://app.link.com" target="_blank" rel="noreferrer">
          Powered by Link <ArrowUpRight size={13} />
        </a>
      </header>
      <main className="welcome-main">
        <section className="welcome-copy">
          <div className="eyebrow green">
            <span className="status-dot" /> A LITTLE CLARITY GOES A LONG WAY
          </div>
          <h1>
            Less noise.
            <br />
            More <span>perspective.</span>
          </h1>
          <p>
            All your connected accounts.
            <br />
            Every transaction. A clearer picture.
          </p>
          <div className="manifest">
            <div className="manifest-head">
              <Terminal size={14} />
              <span>sum / the essentials</span>
              <span className="manifest-dots">···</span>
            </div>
            {[
              ['01', 'Accounts', 'Everything in one place.'],
              ['02', 'Balances', 'Know where you stand.'],
              ['03', 'Transactions', 'Follow the details.'],
            ].map(([n, title, description]) => (
              <div className="manifest-row" key={n}>
                <span>{n}</span>
                <strong>{title}</strong>
                <small>{description}</small>
                <Check size={14} />
              </div>
            ))}
          </div>
          <div className="welcome-caption">
            Less spreadsheet. More headspace.<span>∑</span>
          </div>
        </section>
        <section className="welcome-login">
          <LinkLogin onDone={onDone} />
          <div className="login-foot">Your data stays yours. Always.</div>
        </section>
      </main>
      <footer className="welcome-footer">
        <span>SUM / A PERSONAL FINANCIAL PICTURE</span>
        <span>Built for the details. Designed for the everyday.</span>
      </footer>
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
        <Spinner label="Opening your workspace" />
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
  const [help, setHelp] = useState(false);
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
  const activeAccounts = accounts.data?.data.filter((a) => a.active).length ?? 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
          <span className="version">v0.1</span>
        </div>
        <div className="workspace-label">
          <span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>Personal workspace</strong>
            <span>YOUR MONEY, ORGANIZED</span>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            <Wallet size={17} />
            Accounts<span className="nav-count">{String(activeAccounts).padStart(2, '0')}</span>
          </NavLink>
          <NavLink to="/transactions">
            <Layers2 size={17} />
            Transactions
          </NavLink>
          <NavLink to="/connection">
            <Link2 size={17} />
            Connection
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="source-status">
            <span className={`status-dot ${sync.data?.needsReconnect ? 'amber' : ''}`} />
            <div>
              <strong>
                {sync.data?.needsReconnect ? 'Connection needs attention' : 'Connected with Link'}
              </strong>
              <span>
                {busy
                  ? 'Syncing your data…'
                  : `Last sync · ${ago(sync.data?.lastSuccessAt ?? null)}`}
              </span>
            </div>
          </div>
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <CircleHelp size={15} />A note on your data
            <ArrowUpRight size={13} />
          </button>
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
          <div className="breadcrumb">
            <Terminal size={14} />
            <span>workspace</span>
            <span className="slash">/</span>
            <span className="breadcrumb-current">personal</span>
          </div>
          <div className="topbar-right">
            <span className="topbar-readonly">
              <span className="status-dot" /> READ ONLY
            </span>
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
          {busy && (
            <div className="sync-progress" role="status">
              <span className="status-dot" />
              Updating your financial picture
              <span>{sync.data?.transactionsFetched ?? 0} transactions fetched</span>
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
        <footer className="app-footer">
          <span>
            <span className="footer-mark">∑</span> A little more clarity.
          </span>
          <span>
            DATA FROM LINK <span className="footer-divider">/</span>{' '}
            {sync.data?.historyComplete ? 'ALL AVAILABLE HISTORY' : 'HISTORY IMPORT PENDING'}
          </span>
        </footer>
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
      {help && (
        <Modal title="GOOD TO KNOW" onClose={() => setHelp(false)}>
          <div className="help-content">
            <h2>A snapshot, not a crystal ball.</h2>
            <p>
              Sum shows the financial data your connected accounts make available through Link. Some
              accounts may not support balances or transactions.
            </p>
            <p>
              <strong>Current balance</strong> excludes pending transactions.{' '}
              <strong>Available cash</strong> and <strong>credit used</strong> are shown separately.
              Balances carry their original update time; refreshing Sum doesn’t force your bank to
              update.
            </p>
            <p>
              Transaction amounts are negative for money out and positive for money in. Categories
              and statuses come from Link. Transactions from Link and bank connections are labeled
              separately and aren’t merged by guesswork.
            </p>
            <p>
              Sum checks for updates when you open it after 15 minutes, or when you press Refresh.
              Saved history remains available during temporary outages.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  children,
  aside,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>
          {title}
          <span className="heading-dot">.</span>
        </h1>
        <p className="subtitle">{children}</p>
      </div>
      {aside}
    </div>
  );
}
function AccountIcon({ account }: { account: Account }) {
  return (
    <span className={`account-icon ${account.type === 'card' ? 'card-icon' : ''}`}>
      {account.type === 'card' ? <CreditCard size={22} /> : <Landmark size={22} />}
    </span>
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
      <PageHeading
        eyebrow="01 / YOUR ACCOUNTS"
        title="Everything, accounted for"
        aside={
          <div className="heading-counter">
            <span>{String(active.length).padStart(2, '0')}</span>
            <small>
              CONNECTED
              <br />
              ACCOUNTS
            </small>
          </div>
        }
      >
        A clear view of where your money lives.
      </PageHeading>
      <div className="section-toolbar">
        <div className="segmented" aria-label="Account type">
          {[
            ['all', 'All accounts'],
            ['cash', 'Bank accounts'],
            ['credit', 'Cards & credit'],
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
        <span className="toolbar-caption">BALANCES AS REPORTED BY LINK</span>
      </div>
      {error ? (
        <ErrorNote error={error} />
      ) : pending ? (
        <Spinner label="Reading accounts" />
      ) : !all.length ? (
        <div className="panel">
          <Empty
            title={
              response?.sync.status === 'running'
                ? 'Gathering your accounts'
                : 'Your financial picture starts here'
            }
            icon={<Landmark size={27} />}
          >
            {response?.sync.status === 'running' ? (
              'Accounts will appear as Link returns them. You can keep browsing while history imports.'
            ) : (
              <>
                No accounts are available yet. Manage your accounts in Link, then refresh Sum.
                <br />
                <a href="https://app.link.com" target="_blank" rel="noreferrer">
                  Open Link <ArrowUpRight size={12} />
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
                <div className="account-card-top">
                  <AccountIcon account={account} />
                  <span className="account-kind">{pretty(account.type)}</span>
                  <ArrowUpRight className="account-arrow" size={17} />
                </div>
                <h2>{account.name}</h2>
                <div className="account-meta">
                  {account.institution || 'Connected through Link'}
                  {account.last4 && <span>•• {account.last4}</span>}
                </div>
                <div className="balance-block">
                  {account.balances.length ? (
                    account.balances.map((balance, i) => (
                      <div className="balance-currency" key={i}>
                        <span className="balance-label">
                          CURRENT BALANCE <span>{balance.current.currency}</span>
                        </span>
                        <strong className="balance-amount">
                          {formatMoney(balance.current.amount, balance.current.currency)}
                        </strong>
                        {(balance.type === 'cash' ? balance.available : balance.used).map(
                          (money) => (
                            <div className="secondary-balance" key={money.currency}>
                              <span>
                                {balance.type === 'cash' ? 'Available cash' : 'Credit used'}
                              </span>
                              <span>{formatMoney(money.amount, money.currency)}</span>
                            </div>
                          ),
                        )}
                        <span className="balance-time">Bank updated · {ago(balance.asOf)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="unavailable-balance">
                      <strong>—</strong>
                      <span>Balance unavailable</span>
                      <small>This account hasn’t shared a balance with Link.</small>
                    </div>
                  )}
                </div>
                <div className="account-card-foot">
                  <span>
                    <span
                      className={`status-dot ${account.connectionStatus && !['active', 'connected'].includes(account.connectionStatus) ? 'amber' : ''}`}
                    />
                    {account.connectionStatus ? pretty(account.connectionStatus) : 'Linked account'}
                  </span>
                  <span>
                    View activity <ChevronRight size={13} />
                  </span>
                </div>
              </button>
            ))}
          </div>
          {!shown.length && (
            <Empty title="No accounts in this view">Try another account type.</Empty>
          )}
          {archived.length > 0 && (
            <details className="archived">
              <summary>
                {archived.length} previously connected{' '}
                {archived.length === 1 ? 'account' : 'accounts'}
              </summary>
              {archived.map((account) => (
                <button key={account.id} onClick={() => onAccount(account.id)}>
                  {account.name}
                  <span>
                    Saved transactions <ArrowRight size={13} />
                  </span>
                </button>
              ))}
            </details>
          )}
        </>
      )}
      <div className="data-note">
        <div className="data-note-symbol">i</div>
        <div>
          <strong>The details make the difference.</strong>
          <p>
            Current balances don’t include pending transactions. Your bank’s update time may differ
            from your last Sum sync.
          </p>
        </div>
        <span className="data-note-index">NOTE_001</span>
      </div>
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
  const activeFilters = [...params.entries()].filter(([key, value]) => value && key !== 'q').length;
  return (
    <>
      <PageHeading eyebrow="02 / YOUR TRANSACTIONS" title="Follow the details">
        Your activity, one transaction at a time.
      </PageHeading>
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
            <kbd>/</kbd>
          </label>
          <div className="filter-count">
            <ListFilter size={14} />
            FILTERS{activeFilters > 0 && <span>{activeFilters}</span>}
          </div>
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
          <Empty
            title={query ? 'No matching transactions' : 'Nothing here just yet'}
            icon={<Search size={24} />}
          >
            {query
              ? 'Try a different search or clear your filters.'
              : 'Transactions will appear here after your accounts sync with Link.'}
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
                    <th>
                      <span className="sr-only">Details</span>
                    </th>
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
                          <span
                            className={`transaction-icon ${transaction.amount > 0 ? 'incoming' : ''}`}
                          >
                            {transaction.amount > 0 ? (
                              <ArrowDownLeft size={17} />
                            ) : (
                              <ArrowUpRight size={17} />
                            )}
                          </span>
                          <span>
                            <strong>{transaction.description || 'Transaction'}</strong>
                            <small>
                              {transaction.origin === 'link' ? 'LINK' : 'BANK CONNECTION'}
                              {!['succeeded', 'posted'].includes(transaction.status) && (
                                <>
                                  {' '}
                                  <span className="origin-separator">/</span>{' '}
                                  {pretty(transaction.status)}
                                </>
                              )}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td className="account-cell">{transaction.accountName ?? 'Unassigned'}</td>
                      <td>
                        <span className="category-tag">
                          {transaction.category ? pretty(transaction.category) : 'Uncategorized'}
                        </span>
                      </td>
                      <td className="date-column">{date(transaction.date)}</td>
                      <td className={`amount-column ${transaction.amount > 0 ? 'positive' : ''}`}>
                        {formatMoney(transaction.amount, transaction.currency, true)}
                      </td>
                      <td>
                        <button
                          className="icon-button row-detail"
                          aria-label={`Details for ${transaction.description}`}
                          onClick={() => setSelected(transaction)}
                        >
                          <ChevronRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>{rows.length} TRANSACTIONS SHOWN</span>
              {data.hasNextPage ? (
                <button
                  className="button small"
                  onClick={() => void data.fetchNextPage()}
                  disabled={data.isFetchingNextPage}
                >
                  {data.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  <ArrowDownLeft size={13} />
                </button>
              ) : (
                <span>
                  YOU’RE ALL CAUGHT UP <Check size={12} />
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <div className="transactions-note">
        <ShieldCheck size={14} />
        <span>
          Descriptions, categories, and statuses are provided by Link. All activity is read only.
        </span>
      </div>
      {selected && (
        <Modal title="TRANSACTION / DETAILS" onClose={() => setSelected(null)}>
          <div className="transaction-detail">
            <span className={`transaction-icon large ${selected.amount > 0 ? 'incoming' : ''}`}>
              {selected.amount > 0 ? <ArrowDownLeft size={27} /> : <ArrowUpRight size={27} />}
            </span>
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
            <p className="detail-note">
              {selected.amount < 0
                ? 'Money leaving this account.'
                : selected.amount > 0
                  ? 'Money entering this account.'
                  : 'A zero-amount transaction.'}{' '}
              Amounts are reported by Link.
            </p>
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
      <PageHeading eyebrow="03 / YOUR CONNECTION" title="The source of it all">
        One connection. Your financial picture.
      </PageHeading>
      <div className="connection-layout">
        <section className="connection-card">
          <div className="connection-header">
            <span className="integration-icon">
              <Link2 size={26} />
            </span>
            <div>
              <h2>Link</h2>
              <p>Your connected financial accounts</p>
            </div>
            <span className={`connection-badge ${state?.needsReconnect ? 'attention' : ''}`}>
              {state?.needsReconnect ? 'Needs attention' : 'Connected'}
            </span>
          </div>
          <dl className="connection-facts">
            <div>
              <dt>Signed in as</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Last successful sync</dt>
              <dd>
                {state?.lastSuccessAt
                  ? `${date(state.lastSuccessAt)} · ${ago(state.lastSuccessAt)}`
                  : 'Not synced yet'}
              </dd>
            </div>
            <div>
              <dt>Transaction history</dt>
              <dd>
                {state?.historyComplete
                  ? 'All available Link history imported'
                  : 'Initial import pending'}
              </dd>
            </div>
            <div>
              <dt>Refresh behavior</dt>
              <dd>On open, after 15 minutes · or manually</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                <ShieldCheck size={14} />
                Read only
              </dd>
            </div>
          </dl>
          <div className="connection-actions">
            <button className="button" onClick={onReconnect}>
              Reconnect Link
              <RefreshCw size={14} />
            </button>
            <a
              className="button ghost"
              href="https://app.link.com"
              target="_blank"
              rel="noreferrer"
            >
              Manage accounts in Link
              <ArrowUpRight size={14} />
            </a>
          </div>
        </section>
        <aside className="connection-aside">
          <Database size={24} />
          <h3>A home for your history.</h3>
          <p>
            Sum saves a copy of your available Link data so you can browse quickly, even when a
            connection needs a moment.
          </p>
          <p>
            Account connections are managed in Link. Reconnect here if you need to approve access
            again.
          </p>
          <span className="eyebrow">YOUR WORKSPACE IS PRIVATE TO YOU</span>
        </aside>
      </div>
    </>
  );
}
