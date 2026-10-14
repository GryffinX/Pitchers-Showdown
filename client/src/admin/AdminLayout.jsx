import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { adminRequest, adminSession, UNAUTHORIZED_EVENT } from './adminApi';
import { ToastProvider } from './components/Toast';
import { Spinner } from './components/States';
import './admin.css';

// Client-side guard for convenience only; every /api/admin route is checked on the server
export default function AdminLayout() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(null);
  const [hasToken] = useState(() => !!adminSession.get());

  useEffect(() => {
    if (!hasToken) return;
    let expiryTimer;

    adminRequest('/me')
      .then(data => {
        setAdmin(data.admin);
        const ms = new Date(data.expiresAt).getTime() - Date.now();
        expiryTimer = setTimeout(() => {
          adminSession.clear();
          navigate('/admin', { replace: true, state: { notice: 'Your admin session expired. Please sign in again.' } });
        }, Math.max(ms, 0));
      })
      .catch(() => { /* 401 is handled by the unauthorized listener below */ });

    const onUnauthorized = (e) => navigate('/admin', {
      replace: true,
      state: { notice: e.detail && /expired/i.test(e.detail) ? 'Your admin session expired. Please sign in again.' : 'Please sign in to continue.' },
    });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);

    return () => {
      clearTimeout(expiryTimer);
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [hasToken, navigate]);

  if (!hasToken) return <Navigate to="/admin" replace />;

  const logout = async () => {
    try { await adminRequest('/logout', { method: 'POST' }); } catch { /* token is discarded either way */ }
    adminSession.clear();
    navigate('/admin', { replace: true, state: { notice: 'Signed out.' } });
  };

  return (
    <div className="admin-root">
      {!admin ? <div className="adm-fullscreen"><Spinner label="Checking admin session…" /></div> : (
        <ToastProvider>
          <div className="adm-shell">
            <aside className="adm-sidebar">
              <div className="adm-brand">
                <span className="adm-brand-mark">PS</span>
                <div>
                  <div className="adm-brand-title">Pitcher&apos;s Showdown</div>
                  <div className="adm-brand-sub">Admin console</div>
                </div>
              </div>
              <nav className="adm-nav">
                <NavLink to="/admin/dashboard">Overview</NavLink>
                <NavLink to="/admin/teams">Teams</NavLink>
              </nav>
              <div className="adm-sidebar-foot">
                <div className="adm-muted adm-small">Signed in as <strong>{admin.username}</strong></div>
                <button className="adm-btn adm-btn-ghost adm-btn-block" onClick={logout}>Log out</button>
              </div>
            </aside>
            <main className="adm-main">
              <Outlet context={{ admin }} />
            </main>
          </div>
        </ToastProvider>
      )}
    </div>
  );
}
