import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminRequest, adminSession } from '../adminApi';
import '../admin.css';

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const notice = location.state && location.state.notice;

  // Already signed in in this tab: go straight to the dashboard
  useEffect(() => {
    if (!adminSession.get()) return;
    adminRequest('/me').then(() => navigate('/admin/dashboard', { replace: true })).catch(() => {});
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Enter your admin username and password.');
      return;
    }
    setLoading(true);
    try {
      const data = await adminRequest('/login', { method: 'POST', body: { username: username.trim(), password } });
      adminSession.set(data.token);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-root">
      <div className="adm-login-wrap">
        <form className="adm-login-card" onSubmit={handleSubmit} noValidate>
          <div className="adm-brand adm-brand-center">
            <span className="adm-brand-mark">PS</span>
            <div>
              <div className="adm-brand-title">Pitcher&apos;s Showdown</div>
              <div className="adm-brand-sub">Admin console</div>
            </div>
          </div>

          {notice && !error && <div className="adm-alert adm-alert-info">{notice}</div>}
          {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}

          <label className="adm-field">
            <span>Admin username</span>
            <input className="adm-input" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} disabled={loading} autoFocus />
          </label>
          <label className="adm-field">
            <span>Password</span>
            <input className="adm-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
          </label>
          <button className="adm-btn adm-btn-primary adm-btn-block" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="adm-muted adm-small adm-center">Team accounts cannot sign in here.</p>
        </form>
      </div>
    </div>
  );
}
