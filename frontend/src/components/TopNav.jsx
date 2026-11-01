import { useCallback, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity, Boxes, Check, ChevronDown, ClipboardCheck, Database, FilePlus2, FileText, History,
  Keyboard, Laptop, LayoutDashboard, LogOut, Menu, Moon, Package, RotateCcw, Search,
  Sun, Trash2, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useAssets } from '../context/AssetsContext';
import api from '../api';
import { REGISTER_LIST } from '../lib/registers';
import { VERIFICATION_EVENT } from '../lib/verification';
import ClearAllModal from './ClearAllModal';
import AppLogo from './AppLogo';
import './TopNav.css';

const REGISTER_ICONS = { asset: Laptop, peripheral: Keyboard, software: Package };

const TOP_NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/report', label: 'Report', menu: 'register', icon: FileText },
  { to: '/inventory', label: 'Inventory - In Stock', showCount: 'stock', icon: Boxes },
  { to: '/data-entry', label: 'Data Entry', writeOnly: true, icon: FilePlus2 },
  { to: '/verification', label: 'Verification', verifyOnly: true, showCount: 'verification', icon: ClipboardCheck },
  { to: '/history', label: 'History', icon: History },
  { to: '/masters', label: 'Master Data', adminOnly: true, icon: Database },
  { to: '/activity', label: 'Activity', superadminOnly: true, icon: Activity },
];

const DRAWER_STARS = [
  { left: 14, size: 11, delay: 0, duration: 3.4 },
  { left: 32, size: 8, delay: 1.3, duration: 2.8 },
  { left: 51, size: 13, delay: 0.6, duration: 3.8 },
  { left: 68, size: 9, delay: 2.1, duration: 3.1 },
  { left: 84, size: 10, delay: 0.9, duration: 3.5 },
  { left: 24, size: 7, delay: 2.7, duration: 2.6 },
  { left: 76, size: 12, delay: 3.2, duration: 4 },
];

const NavDrawer = ({
  items, badgeFor, register, onReport, onChooseRegister, onClose,
}) => {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    panelRef.current?.querySelector('a, button')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="nav-drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="nav-drawer" ref={panelRef} aria-label="Main Navigation" role="dialog" aria-modal="true">
        <div className="nav-drawer-head">
          <span className="nav-drawer-brand">
            <AppLogo size={20} gradient={true} />
            IT Asset Engine
          </span>
          <button type="button" className="nav-drawer-close" onClick={onClose} aria-label="Close the menu">
            <X size={20} />
          </button>
        </div>

        <nav className="nav-drawer-links">
          {items.map(({ to, label, end, showCount, menu, icon: Icon }) => (menu === 'register' ? (
            <div key={to} className="nav-drawer-group">
              <span className={`nav-drawer-link nav-drawer-group-title${onReport ? ' active' : ''}`}>
                <Icon size={18} aria-hidden="true" /> {label}
              </span>
              {REGISTER_LIST.map((reg) => {
                const RegIcon = REGISTER_ICONS[reg.key];
                const current = onReport && register === reg.key;
                return (
                  <button
                    key={reg.key}
                    type="button"
                    className={`nav-drawer-sublink${current ? ' active' : ''}`}
                    onClick={() => onChooseRegister(reg.key)}
                  >
                    {RegIcon && <RegIcon size={16} aria-hidden="true" />}
                    {reg.label}
                    {current && <Check size={15} className="nav-drawer-check" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) => `nav-drawer-link${isActive ? ' active' : ''}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="nav-drawer-label">{label}</span>
              {showCount && badgeFor(showCount) > 0 && (
                <span className={`top-tab-badge${showCount === 'verification' ? ' is-waiting' : ''}`}>
                  {badgeFor(showCount)}
                </span>
              )}
            </NavLink>
          )))}
          <div className="nav-drawer-stars" aria-hidden="true">
            {DRAWER_STARS.map((s, i) => (
              <span
                key={i}
                className="nav-drawer-star"
                style={{
                  left: `${s.left}%`,
                  fontSize: `${s.size}px`,
                  animationDelay: `${s.delay}s`,
                  animationDuration: `${s.duration}s`,
                }}
              >
                ✦
              </span>
            ))}
          </div>
        </nav>
      </aside>
    </div>,
    document.body,
  );
};

const REVEAL_PX = 104;
const PHONE_BAR_QUERY = '(max-width: 680px)';
const LOGO_SRC = '/ambuja-neotia-logo-white.png';
const Z_HOME = 55;
const Z_AWAY = 10000;

const clampToWindow = (x, y, rest) => ({
  x: Math.max(-rest.left, Math.min(window.innerWidth - rest.right, x)),
  y: Math.max(-rest.top, Math.min(window.innerHeight - rest.bottom, y)),
});

const BrandReveal = ({
  onClear, onHome, phone = false, visible = true, onAwayChange = null, remeasureKey = null,
}) => {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [away, setAway] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [slot, setSlot] = useState(null);
  const drag = useRef(null);
  const slotRef = useRef(null);

  const goHome = () => { setAway(false); setPos({ x: 0, y: 0 }); };

  const restRect = () => (slot
    ? { left: slot.left, top: slot.top, right: slot.left + slot.width, bottom: slot.top + slot.height }
    : { left: 0, top: 0, right: 0, bottom: 0 });

  useLayoutEffect(() => {
    const el = slotRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSlot((prev) => (prev && prev.left === r.left && prev.top === r.top
        && prev.width === r.width && prev.height === r.height
        ? prev : { left: r.left, top: r.top, width: r.width, height: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const bar = el.closest('.top-nav-left');
    if (bar) ro.observe(bar);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);

  useLayoutEffect(() => {
    const r = slotRef.current?.getBoundingClientRect();
    if (r) setSlot({ left: r.left, top: r.top, width: r.width, height: r.height });
  }, [remeasureKey]);

  useEffect(() => { onAwayChange?.(away || dragging); }, [away, dragging, onAwayChange]);

  useEffect(() => {
    if (slot && away) setPos((p) => clampToWindow(p.x, p.y, restRect()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, away]);

  useEffect(() => {
    if (!away) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') goHome(); };
    const onResize = () => setPos((p) => clampToWindow(p.x, p.y, restRect()));
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [away, slot]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y, rest: restRect(), moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.sx;
    const my = e.clientY - d.sy;
    if (Math.hypot(mx, my) > 4) d.moved = true;
    setPos(clampToWindow(d.bx + mx, d.by + my, d.rest));
  };
  const onPointerUp = () => {
    const was = drag.current;
    if (!was) return;
    drag.current = null;
    setDragging(false);
    if (!was.moved) {
      if (away) goHome(); else onHome();
      return;
    }
    if (Math.hypot(pos.x, pos.y) < REVEAL_PX / 2) goHome();
    else setAway(true);
  };

  const shown = away ? 1 : Math.min(1, Math.hypot(pos.x, pos.y) / REVEAL_PX);
  const lifted = away || dragging || pos.x !== 0 || pos.y !== 0;
  return (
    <span className="brand-reveal" ref={slotRef}>
      <img src={LOGO_SRC} alt="" aria-hidden="true" className="top-brand-corp-logo brand-reveal-placeholder" />
      <span
        className="brand-reveal-actions"
        style={{ opacity: shown, pointerEvents: away ? 'auto' : 'none' }}
        aria-hidden={!away}
      >
        <button
          type="button"
          className="brand-reveal-btn"
          tabIndex={away ? 0 : -1}
          onClick={() => { goHome(); onClear(); }}
          title="Clear all data"
        >
          <Trash2 size={12} /> Clear all data
        </button>
        <button
          type="button"
          className="brand-reveal-home"
          tabIndex={away ? 0 : -1}
          onClick={goHome}
          title="Put the logo back (or press Esc)"
          aria-label="Put the logo back"
        >
          <RotateCcw size={12} />
        </button>
      </span>
      {slot && createPortal(
        <img
          src={LOGO_SRC}
          alt="AmbujaNeotia"
          title={away ? 'AmbujaNeotia — click to put back' : 'AmbujaNeotia — Home'}
          className={`top-brand-corp-logo brand-reveal-logo${dragging ? ' is-dragging' : ''}${shown > 0.1 ? ' is-away' : ''}${phone ? ' is-phone' : ''}${phone && !visible && !lifted ? ' is-swap-hidden' : ''}`}
          draggable={false}
          style={{
            position: 'fixed',
            left: slot.left,
            top: slot.top,
            width: slot.width,
            height: slot.height,
            zIndex: lifted ? Z_AWAY : Z_HOME,
            transform: `translate(${pos.x}px, ${pos.y}px)`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />,
        document.body,
      )}
    </span>
  );
};

const TopNav = () => {
  const { user, isAdmin, isSuperadmin, canWrite, canVerify, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { assets, register, setRegister, meta } = useAssets();
  const navigate = useNavigate();
  const location = useLocation();

  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const [compact, setCompact] = useState(false);
  const headerRef = useRef(null);

  const [phoneBar, setPhoneBar] = useState(() => window.matchMedia(PHONE_BAR_QUERY).matches);
  const [swapLogo, setSwapLogo] = useState(false);
  const [logoAway, setLogoAway] = useState(false);
  const [revealLeft, setRevealLeft] = useState(null);
  const swapRef = useRef(null);
  const leftRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia(PHONE_BAR_QUERY);
    const onChange = () => setPhoneBar(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!phoneBar) { setSwapLogo(false); return undefined; }
    if (logoAway) return undefined;
    const timer = setInterval(() => setSwapLogo((on) => !on), 5000);
    return () => clearInterval(timer);
  }, [phoneBar, logoAway]);

  useLayoutEffect(() => {
    if (!phoneBar || !isSuperadmin) { setRevealLeft(null); return undefined; }
    const place = () => {
      const swap = swapRef.current?.getBoundingClientRect();
      const bar = leftRef.current?.getBoundingClientRect();
      if (swap && bar) setRevealLeft(Math.round(swap.left - bar.left));
    };
    place();
    const ro = new ResizeObserver(place);
    if (leftRef.current) ro.observe(leftRef.current);
    return () => ro.disconnect();
  }, [phoneBar, isSuperadmin]);

  const showLogo = phoneBar && (swapLogo || logoAway);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  const dropdownRef = useRef(null);
  const navRef = useRef(null);

  const [reportMenu, setReportMenu] = useState(null);
  const reportBtnRef = useRef(null);
  const reportMenuRef = useRef(null);
  const onReport = location.pathname.startsWith('/report');

  const toggleReportMenu = () => {
    if (reportMenu) { setReportMenu(null); return; }
    const r = reportBtnRef.current?.getBoundingClientRect();
    if (r) setReportMenu({ top: r.bottom + 8, left: r.left });
  };

  const chooseRegister = (key) => {
    setRegister(key);
    setReportMenu(null);
    navigate('/report');
  };

  useEffect(() => {
    if (!reportMenu) return undefined;
    const close = () => setReportMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const strip = navRef.current;
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    strip?.addEventListener('scroll', close);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      strip?.removeEventListener('scroll', close);
    };
  }, [reportMenu]);

  const [gliderStyle, setGliderStyle] = useState({ opacity: 0, left: 0, width: 0 });

  const updateActiveGlider = () => {
    const navEl = navRef.current;
    if (!navEl) return;
    const activeTab = navEl.querySelector('.top-nav-tab.active');
    if (activeTab) {
      const tabRect = activeTab.getBoundingClientRect();
      const navRect = navEl.getBoundingClientRect();
      setGliderStyle({
        left: tabRect.left - navRect.left + navEl.scrollLeft,
        width: tabRect.width,
        opacity: 1,
      });
    } else {
      setGliderStyle((prev) => ({ ...prev, opacity: 0 }));
    }
  };

  useEffect(() => {
    const timer = setTimeout(updateActiveGlider, 60);
    window.addEventListener('resize', updateActiveGlider);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateActiveGlider);
    };
  }, [location.pathname]);

  const handleTabMouseEnter = (e) => {
    const tabEl = e.currentTarget;
    const navEl = navRef.current;
    if (!tabEl || !navEl) return;
    const tabRect = tabEl.getBoundingClientRect();
    const navRect = navEl.getBoundingClientRect();
    setGliderStyle({
      left: tabRect.left - navRect.left + navEl.scrollLeft,
      width: tabRect.width,
      opacity: 1,
    });
    tabEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  };

  const handleNavMouseMove = (e) => {
    const navEl = navRef.current;
    if (!navEl) return;
    const maxScroll = navEl.scrollWidth - navEl.clientWidth;
    if (maxScroll <= 0) return;
    const rect = navEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, mouseX / rect.width));
    navEl.scrollTo({
      left: ratio * maxScroll,
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setUserDropdownOpen(false);
      }
      if (!reportBtnRef.current?.contains(e.target)
        && !reportMenuRef.current?.contains(e.target)) {
        setReportMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCleared = (message) => {
    setClearOpen(false);
    window.alert(message);
  };

  const inStockCount = assets?.filter(a => {
    const s = (a.status || '').toLowerCase();
    return !a.isDeleted && (s.includes('stock') || s === 'c - in stock');
  }).length || 0;

  const [waitingCount, setWaitingCount] = useState(0);
  useEffect(() => {
    if (!canVerify) return undefined;
    let live = true;
    const fetchCount = () => {
      api.get('/verification/count')
        .then((res) => {
          if (!live) return;
          const d = res.data || {};
          setWaitingCount(d.forYou ?? ((d.pending || 0) + (d.rejected || 0)));
        })
        .catch(() => {  });
    };
    fetchCount();
    window.addEventListener(VERIFICATION_EVENT, fetchCount);
    return () => {
      live = false;
      window.removeEventListener(VERIFICATION_EVENT, fetchCount);
    };
  }, [canVerify, location.pathname]);

  const badgeFor = (kind) => (kind === 'verification' ? waitingCount : kind === 'stock' ? inStockCount : 0);

  const getPageTitle = () => {
    const path = location.pathname;
    if (path.startsWith('/report/new-vs-replaced')) return 'New vs Replaced';
    if (path.startsWith('/report')) return `Report · ${meta.label}`;
    if (path.startsWith('/inventory')) return 'Inventory';
    if (path === '/') return 'Dashboard';
    if (path.startsWith('/data-entry')) return 'Data Entry';
    if (path.startsWith('/verification')) return 'Verification';
    if (path.startsWith('/find')) return 'Find Asset';
    if (path.startsWith('/history')) return 'History';
    if (path.startsWith('/masters') || path.startsWith('/users')) return 'Master Data';
    if (path.startsWith('/activity')) return 'Activity';
    return 'Console';
  };

  const userInitial = (user?.fullName || user?.username || 'U').trim().charAt(0).toUpperCase();

  const visibleItems = TOP_NAV_ITEMS.filter((item) => (!item.adminOnly || isAdmin)
    && (!item.writeOnly || canWrite)
    && (!item.verifyOnly || canVerify)
    && (!item.superadminOnly || isSuperadmin));

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    const fit = () => {
      const links = navRef.current;
      const left = header.querySelector('.top-nav-left');
      const right = header.querySelector('.top-nav-right');
      if (!links || !left || !right || !links.scrollWidth) return;
      const pad = parseFloat(getComputedStyle(header).paddingLeft) + parseFloat(getComputedStyle(header).paddingRight);
      const menuBtn = header.querySelector('.top-menu-btn');
      const leftWidth = left.getBoundingClientRect().width - (menuBtn?.offsetWidth ? menuBtn.offsetWidth + 10 : 0);
      const needed = leftWidth + 20 + links.scrollWidth + right.getBoundingClientRect().width + pad + 2;
      setCompact(needed > header.clientWidth);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(header);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [visibleItems.length, inStockCount, waitingCount, isSuperadmin]);

  return (
    <>
      <header className={`top-nav${compact ? ' is-compact' : ''}`} ref={headerRef}>
        <div className="top-nav-left" ref={leftRef}>
          <button
            type="button"
            className="top-menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open the menu"
            aria-expanded={drawerOpen}
            title="Menu"
          >
            <Menu size={20} />
          </button>
          <NavLink to="/" className="top-brand" title="IT Asset Engine by AmbujaNeotia — Home">
            <div className="top-brand-icon">
              <AppLogo size={22} gradient={true} trace={true} />
            </div>
            <span className={`top-brand-swap${showLogo ? ' show-logo' : ''}`} ref={swapRef}>
              <span className="top-brand-text">IT Asset Engine</span>
              <img
                src="/ambuja-neotia-logo-white.png"
                alt=""
                aria-hidden="true"
                className={`top-brand-swap-logo${isSuperadmin ? ' is-reserved' : ''}`}
                draggable={false}
              />
            </span>
            <span className="top-brand-by">by</span>
            {!isSuperadmin && (
              <span className="top-brand-corp">
                <img
                  src="/ambuja-neotia-logo-white.png"
                  alt="AmbujaNeotia"
                  className="top-brand-corp-logo"
                />
              </span>
            )}
          </NavLink>
          {isSuperadmin && (
            <span
              className="top-brand-corp top-brand-corp-reveal"
              style={revealLeft !== null ? { left: revealLeft } : undefined}
            >
              <BrandReveal
                onClear={() => setClearOpen(true)}
                onHome={() => navigate('/')}
                phone={phoneBar}
                visible={!phoneBar || showLogo}
                onAwayChange={setLogoAway}
                remeasureKey={`${phoneBar}-${revealLeft}`}
              />
            </span>
          )}

          <div className="top-nav-divider" />

          <span className="top-section-title">{getPageTitle()}</span>
        </div>

        <div className="top-nav-center">
          <nav
            className="top-nav-links"
            ref={navRef}
            aria-label="Main Navigation"
            onMouseMove={handleNavMouseMove}
            onMouseLeave={updateActiveGlider}
          >
            <span
              className="nav-tab-glider"
              style={{
                transform: `translateX(${gliderStyle.left}px)`,
                width: `${gliderStyle.width}px`,
                opacity: gliderStyle.opacity,
              }}
              aria-hidden="true"
            />
            {visibleItems
              .map(({ to, label, end, showCount, menu }) => (menu === 'register' ? (
                <button
                  key={to}
                  ref={reportBtnRef}
                  type="button"
                  className={`top-nav-tab top-nav-tab-menu${onReport ? ' active' : ''}`}
                  onClick={toggleReportMenu}
                  onMouseEnter={handleTabMouseEnter}
                  aria-haspopup="menu"
                  aria-expanded={Boolean(reportMenu)}
                  title={onReport ? `Report — showing ${meta.label}` : 'Report — choose Assets, Peripherals or Softwares'}
                >
                  <span className="top-tab-text">{label}</span>
                  <ChevronDown
                    size={13}
                    className={`top-tab-caret${reportMenu ? ' open' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => `top-nav-tab${isActive ? ' active' : ''}`}
                  onMouseEnter={handleTabMouseEnter}
                >
                  <span className="top-tab-text">{label}</span>
                  {showCount && badgeFor(showCount) > 0 && (
                    <span
                      className={`top-tab-badge${showCount === 'verification' ? ' is-waiting' : ''}`}
                      title={showCount === 'verification' ? `${badgeFor(showCount)} waiting on you in Verification` : undefined}
                    >
                      {badgeFor(showCount)}
                    </span>
                  )}
                </NavLink>
              )))}
          </nav>
        </div>

        {reportMenu && (
          <div
            ref={reportMenuRef}
            className="top-dropdown-menu report-menu"
            role="menu"
            aria-label="Open the report for"
            style={{ position: 'fixed', top: reportMenu.top, left: reportMenu.left, right: 'auto' }}
          >
            {REGISTER_LIST.map((reg) => {
              const Icon = REGISTER_ICONS[reg.key];
              const current = onReport && register === reg.key;
              return (
                <button
                  key={reg.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  className={`dropdown-item report-menu-item${current ? ' current' : ''}`}
                  onClick={() => chooseRegister(reg.key)}
                >
                  {Icon && <Icon size={14} aria-hidden="true" />}
                  <span className="report-menu-label">{reg.label}</span>
                  {current && <Check size={14} className="report-menu-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}

        <div className="top-nav-right">
          <button
            type="button"
            className={`top-icon-btn${location.pathname.startsWith('/find') ? ' active' : ''}`}
            onClick={() => navigate('/find')}
            title="Find an Asset / Serial Scanner"
            aria-label="Find an Asset"
          >
            <Search size={16} />
          </button>

          <button
            type="button"
            className="top-icon-btn top-theme-btn"
            onClick={(e) => toggleTheme(e)}
            title={isDark ? 'Switch to Light theme' : 'Switch to Dark theme'}
            aria-label="Toggle Theme"
          >
            <span className="theme-toggle-icon">
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </span>
            <span className="theme-burst-ring" aria-hidden="true" />
          </button>

          <div className="top-dropdown-wrap" ref={dropdownRef}>
            <button
              type="button"
              className="top-user-avatar-btn"
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              aria-label="User Menu"
              title={`${user?.fullName || user?.username || 'User'} (${user?.role || ''})`}
            >
              <div className="top-user-avatar">
                {userInitial}
              </div>
            </button>

            {userDropdownOpen && (
              <div className="top-dropdown-menu user-menu">
                <div className="dropdown-header user-dropdown-header">
                  <div className="user-dropdown-name">{user?.fullName || user?.username || 'User'}</div>
                  <div className="user-dropdown-email">
                    {user?.email?.trim() || `${(user?.username || 'user').toLowerCase()}@ambujaneotia.com`}
                  </div>
                  <div className="user-dropdown-role">{user?.role || 'Staff'}</div>
                </div>
                <div className="dropdown-divider" />
                <button
                  type="button"
                  className="dropdown-item dropdown-item-danger"
                  onClick={() => { setUserDropdownOpen(false); logout(); }}
                >
                  <LogOut size={14} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="top-nav-border-tracer" aria-hidden="true">
          <div className="top-nav-tracer-dot">
            <div className="top-nav-tracer-corona" />
            <div className="top-nav-tracer-halo" />
            <div className="top-nav-tracer-beam" />
            <div className="top-nav-tracer-core" />
          </div>
        </div>
      </header>

      {clearOpen && (
        <ClearAllModal onClose={() => setClearOpen(false)} onCleared={handleCleared} />
      )}

      {drawerOpen && (
        <NavDrawer
          items={visibleItems}
          badgeFor={badgeFor}
          register={register}
          onReport={onReport}
          onChooseRegister={(key) => { setDrawerOpen(false); chooseRegister(key); }}
          onClose={closeDrawer}
        />
      )}
    </>
  );
};

export default TopNav;
