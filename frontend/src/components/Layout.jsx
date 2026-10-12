import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import Icon from './Icon.jsx'
import Avatar from './Avatar.jsx'
import LanguageSwitch from './LanguageSwitch.jsx'

const nav = [
  { to: '/', key: 'nav.overview', icon: 'space_dashboard', end: true },
  { to: '/plans', key: 'nav.plans', icon: 'workspace_premium' },
  { to: '/coins', key: 'nav.coins', icon: 'toll' },
  { to: '/shop', key: 'nav.shop', icon: 'storefront' },
  { to: '/inventory', key: 'nav.inventory', icon: 'inventory_2' },
  { to: '/history', key: 'nav.history', icon: 'receipt_long' },
]

export function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark"><Icon name="diamond" fill /></span>
      Coinly
    </div>
  )
}

function UserMenu({ user, onLogout }) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Avatar user={user} />
        <span className="user-meta">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </span>
        <Icon name="expand_more" />
      </button>
      {open && (
        <div className="dropdown">
          <button onClick={() => { setOpen(false); navigate('/settings') }}><Icon name="settings" /> {t('nav.settings')}</button>
          <button onClick={onLogout}><Icon name="logout" /> {t('menu.signout')}</button>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { t, num } = useI18n()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setMenuOpen(false), [pathname])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <Logo />
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              <Icon name={n.icon} /> {t(n.key)}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/settings" className="nav-link">
            <Icon name="settings" /> {t('nav.settings')}
          </NavLink>
          <div className="promo">
            <div className="promo-art"><Icon name="diamond" fill size={34} /></div>
            <strong>{t('promo.title')}</strong>
            <p>{t('promo.text')}</p>
            <button className="btn btn-dark btn-block" onClick={() => navigate('/plans')}>{t('promo.cta')}</button>
          </div>
        </div>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setMenuOpen(true)} aria-label={t('top.menu')}>
            <Icon name="menu" />
          </button>
          <label className="search">
            <Icon name="search" />
            <input placeholder={t('top.search')} aria-label={t('top.search')} />
          </label>
          <div className="topbar-right">
            <LanguageSwitch />
            <button className="coin-pill" onClick={() => navigate('/coins')} title={t('top.topup')}>
              <Icon name="toll" fill /> {num(user.coins)}
              <span className="coin-plus"><Icon name="add" size={16} /></span>
            </button>
            <button className="icon-btn round" aria-label={t('top.notifications')}><Icon name="notifications" /></button>
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
