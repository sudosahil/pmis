import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { initials } from '../lib/format';
import type { Notification } from '../types';
import {
  BellIcon, BuildingIcon, ChartIcon, FileTextIcon, FolderIcon, GavelIcon, HomeIcon,
  InboxIcon, LayersIcon, LogOutIcon, MenuIcon, ReceiptIcon, SearchIcon, SettingsIcon,
  ShieldIcon, UsersIcon, WalletIcon,
} from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  /**
   * The permission that opens this screen. Omit to show it to everyone.
   * Which roles hold it is configured on the role access screen.
   */
  permission?: string;
  /** Shows a live count beside the label. */
  badge?: 'approvals' | 'chat';
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: <HomeIcon /> },
      { to: '/approvals', label: 'My approvals', icon: <InboxIcon />, permission: 'approvals.act', badge: 'approvals' },
      { to: '/notifications', label: 'Notifications', icon: <BellIcon /> },
      { to: '/chat', label: 'Messages', icon: <UsersIcon />, permission: 'chat.use', badge: 'chat' },
    ],
  },
  {
    title: 'Documents',
    items: [
      { to: '/files', label: 'Files', icon: <FolderIcon />, permission: 'files.view' },
    ],
  },
  {
    title: 'Works',
    items: [
      { to: '/projects', label: 'Projects', icon: <FolderIcon />, permission: 'projects.view' },
      { to: '/packages', label: 'Packages', icon: <LayersIcon />, permission: 'projects.view' },
    ],
  },
  {
    title: 'Procurement',
    items: [
      { to: '/tenders', label: 'Tenders', icon: <GavelIcon />, permission: 'tenders.view' },
      { to: '/my-bids', label: 'My bids', icon: <FileTextIcon />, permission: 'tenders.bid' },
      { to: '/contractors', label: 'Contractors', icon: <BuildingIcon />, permission: 'contractors.view' },
    ],
  },
  {
    title: 'Bills & payments',
    items: [
      { to: '/ra-bills', label: 'RA bills', icon: <ReceiptIcon />, permission: 'bills.ra.view' },
      { to: '/misc-bills', label: 'Miscellaneous bills', icon: <FileTextIcon />, permission: 'bills.misc.view' },
      { to: '/funds', label: 'Funds & LOC', icon: <WalletIcon />, permission: 'funds.view' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/masters', label: 'Master data', icon: <SettingsIcon />, permission: 'masters.view' },
      { to: '/workflows', label: 'Approval chains', icon: <ChartIcon />, permission: 'workflows.view' },
      { to: '/users', label: 'Users', icon: <UsersIcon />, permission: 'users.manage' },
      { to: '/roles', label: 'Role access', icon: <ShieldIcon />, permission: 'roles.manage' },
      { to: '/audit', label: 'Audit trail', icon: <FileTextIcon />, permission: 'audit.view' },
      { to: '/activity', label: 'Live activity', icon: <ChartIcon />, permission: 'activity.view' },
    ],
  },
];

export function AppLayout() {
  const { user, signOut, isContractor, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  const notifications = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<Page<Notification> & { unread: number }>('/notifications', { pageSize: 1 }),
    refetchInterval: 60_000,
  });

  const approvals = useQuery({
    queryKey: ['approvals', 'count'],
    queryFn: () => api.get<Page<unknown>>('/approvals/inbox', { pageSize: 1 }),
    enabled: !isContractor,
    refetchInterval: 60_000,
  });

  const chatUnread = useQuery({
    queryKey: ['chat', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/chat/unread'),
    refetchInterval: 20_000,
  });

  if (!user) return null;

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);

  const posting = user.divisionName ?? user.circleName ?? user.zoneName ?? user.contractorName;

  return (
    <div className="app-shell">
      <div className="app-brand">
        <span className="app-brand__mark">PMIS</span>
        <div className="app-brand__text">
          <div className="app-brand__title">PMIS</div>
          <div className="app-brand__sub">Public Works Department</div>
        </div>
      </div>

      <header className="app-header">
        <button
          type="button"
          className="header-btn"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          style={{ display: 'none' }}
          data-mobile-only
        >
          <MenuIcon />
        </button>

        <form
          className="header-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (search.trim()) navigate(`/search?q=${encodeURIComponent(search.trim())}`);
          }}
        >
          <label htmlFor="global-search" className="visually-hidden">
            Search projects, tenders and bills
          </label>
          <input
            id="global-search"
            type="search"
            placeholder="Search projects, tenders, bills…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="header-search__icon"><SearchIcon /></span>
        </form>

        <div className="header-actions">
          <Link to="/notifications" className="header-btn" aria-label="Notifications">
            <BellIcon />
            {(notifications.data?.unread ?? 0) > 0 && (
              <span className="header-btn__badge">
                {notifications.data!.unread > 99 ? '99+' : notifications.data!.unread}
              </span>
            )}
          </Link>

          <div ref={userMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="header-user"
              onClick={() => setUserMenuOpen((open) => !open)}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
            >
              <span className="header-user__avatar">{initials(user.fullName)}</span>
              <span>
                <span className="header-user__name">{user.fullName}</span>
                <span className="header-user__role">
                  {user.designation ?? user.roleName}
                  {posting ? ` · ${posting}` : ''}
                </span>
              </span>
            </button>

            {userMenuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 6px)', minWidth: 230,
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 60,
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{user.fullName}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-600)' }}>{user.email}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-600)', marginTop: 2 }}>
                    {user.roleName}{posting ? ` · ${posting}` : ''}
                  </div>
                </div>
                <Link
                  to="/profile"
                  role="menuitem"
                  style={{ display: 'block', padding: '10px 14px', color: 'var(--ink-900)' }}
                >
                  Profile & password
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void signOut().then(() => navigate('/login'));
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '10px 14px', border: 'none', borderTop: '1px solid var(--line-soft)',
                    background: 'transparent', cursor: 'pointer', textAlign: 'left',
                    color: 'var(--danger-fg)', fontWeight: 600,
                  }}
                >
                  <LogOutIcon /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav className={`app-sidebar${menuOpen ? ' is-open' : ''}`} aria-label="Main">
        {visibleGroups.map((group) => (
          <div key={group.title} className="nav-section">
            <h2 className="nav-section__title">{group.title}</h2>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
              >
                <span className="nav-link__icon">{item.icon}</span>
                <span>{item.label}</span>
                {item.badge === 'approvals' && (approvals.data?.total ?? 0) > 0 && (
                  <span className="nav-link__count">{approvals.data!.total}</span>
                )}
                {item.badge === 'chat' && (chatUnread.data?.unread ?? 0) > 0 && (
                  <span className="nav-link__count">{chatUnread.data!.unread}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <main className="app-main">
        <div className="app-main__inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
