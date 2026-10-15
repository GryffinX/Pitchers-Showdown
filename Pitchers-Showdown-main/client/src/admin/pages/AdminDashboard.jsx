import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminRequest, formatDate, formatMoney } from '../adminApi';
import { Spinner, ErrorState, EmptyState } from '../components/States';

const Stat = ({ label, value, hint }) => (
  <div className="adm-stat">
    <div className="adm-stat-label">{label}</div>
    <div className="adm-stat-value">{value}</div>
    {hint && <div className="adm-stat-hint">{hint}</div>}
  </div>
);

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    adminRequest('/stats').then(setStats).catch(err => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <header className="adm-page-head">
        <div>
          <h1>Overview</h1>
          <p className="adm-muted">Live numbers from the event database.</p>
        </div>
        <button className="adm-btn adm-btn-ghost" onClick={load}>Refresh</button>
      </header>

      {error ? <ErrorState message={error} onRetry={load} /> : !stats ? <Spinner /> : (
        <>
          <section className="adm-stats">
            <Stat label="Active teams" value={stats.activeTeams} hint={stats.deletedTeams ? `${stats.deletedTeams} deleted` : 'None deleted'} />
            <Stat
              label="Teams that invested"
              value={`${stats.teamsThatInvested} / ${stats.activeTeams}`}
              hint={`${stats.investmentCount} investment${stats.investmentCount === 1 ? '' : 's'} placed`}
            />
            <Stat label="Total invested" value={formatMoney(stats.totalInvested)} hint="Across all investments" />
            <Stat label="Unspent balance" value={formatMoney(stats.totalRemainingBalance)} hint={`Active teams · ${formatMoney(stats.startingBalance)} starting purse each`} />
          </section>

          <section className="adm-panel">
            <div className="adm-panel-head">
              <h2>Newest teams</h2>
              <Link className="adm-link" to="/admin/teams">All teams →</Link>
            </div>
            {stats.recentTeams.length === 0 ? <EmptyState>No teams yet.</EmptyState> : (
              <ul className="adm-list">
                {stats.recentTeams.map(t => (
                  <li key={t.id}>
                    <div>
                      <div className="adm-strong">{t.name}</div>
                      <div className="adm-muted adm-small">{t.username}</div>
                    </div>
                    <div className="adm-right">
                      <div>{formatMoney(t.balance)}</div>
                      <div className="adm-muted adm-small">{formatDate(t.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
