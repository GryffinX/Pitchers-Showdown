import React, { useCallback, useEffect, useState } from 'react';
import { adminRequest, formatDate, formatMoney } from '../adminApi';
import { Spinner, ErrorState, EmptyState } from '../components/States';
import Pagination from '../components/Pagination';
import {
  CreateTeamModal, RenameTeamModal, ResetPasswordModal, DeleteTeamModal, TeamDetailsModal,
} from '../components/TeamModals';

const COLUMNS = [
  { key: 'name', label: 'Team' },
  { key: 'balance', label: 'Balance', align: 'right' },
  { key: 'createdAt', label: 'Created' },
];

export default function AdminTeams() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState({ q: '', status: 'active', sort: 'createdAt', order: 'desc', page: 1 });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { type, team }

  // Debounce typing into the search box
  useEffect(() => {
    const t = setTimeout(() => setQuery(q => (q.q === search.trim() ? q : { ...q, q: search.trim(), page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminRequest('/teams', { query: { ...query, limit: 20 } })
      .then(result => {
        // Deleting the last row on a page: step back a page
        if (result.teams.length === 0 && query.page > 1) setQuery(q => ({ ...q, page: q.page - 1 }));
        else setData(result);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const sortBy = (key) => setQuery(q => ({
    ...q,
    sort: key,
    order: q.sort === key && q.order === 'asc' ? 'desc' : 'asc',
    page: 1,
  }));

  const closeModal = () => setModal(null);
  const open = (type, team) => () => setModal({ type, team });

  return (
    <>
      <header className="adm-page-head">
        <div>
          <h1>Teams</h1>
          <p className="adm-muted">Create accounts, rename teams, reset passwords and remove teams.</p>
        </div>
        <button className="adm-btn adm-btn-primary" onClick={() => setModal({ type: 'create' })}>+ New team</button>
      </header>

      <div className="adm-toolbar">
        <input
          className="adm-input adm-search"
          type="search"
          placeholder="Search team name or username"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search teams"
        />
        <select className="adm-input" value={query.status} onChange={e => setQuery(q => ({ ...q, status: e.target.value, page: 1 }))} aria-label="Status">
          <option value="active">Active teams</option>
          <option value="deleted">Deleted teams</option>
          <option value="all">All teams</option>
        </select>
      </div>

      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Spinner /> : (
        <div className={`adm-panel adm-panel-flush ${loading ? 'adm-loading' : ''}`}>
          {data.teams.length === 0 ? (
            <EmptyState>{query.q ? `No teams match “${query.q}”.` : 'No teams here yet.'}</EmptyState>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    {COLUMNS.map(col => (
                      <th key={col.key} className={col.align === 'right' ? 'adm-right' : ''}>
                        <button className="adm-sort" onClick={() => sortBy(col.key)}>
                          {col.label}
                          <span aria-hidden="true">{query.sort === col.key ? (query.order === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                        </button>
                      </th>
                    ))}
                    <th>Status</th>
                    <th>ID</th>
                    <th className="adm-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.teams.map(team => (
                    <tr key={team.id}>
                      <td>
                        <button className="adm-team-link" onClick={open('details', team)}>{team.name}</button>
                        <div className="adm-muted adm-small">{team.username}</div>
                      </td>
                      <td className="adm-right adm-nowrap">{formatMoney(team.balance)}</td>
                      <td className="adm-nowrap">{formatDate(team.createdAt)}</td>
                      <td><span className={`adm-badge adm-badge-${team.status}`}>{team.status}</span></td>
                      <td className="adm-mono adm-muted adm-small" title={team.id}>…{String(team.id).slice(-6)}</td>
                      <td className="adm-right">
                        <div className="adm-row-actions">
                          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={open('details', team)}>View</button>
                          {team.status === 'active' && <>
                            <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={open('rename', team)}>Rename</button>
                            <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={open('reset', team)}>Reset password</button>
                            <button className="adm-btn adm-btn-danger-ghost adm-btn-sm" onClick={open('delete', team)}>Delete</button>
                          </>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={data.page} pages={data.pages} total={data.total} noun="team" onChange={page => setQuery(q => ({ ...q, page }))} />
        </div>
      )}

      {modal && modal.type === 'create' && <CreateTeamModal onClose={closeModal} onCreated={load} />}
      {modal && modal.type === 'details' && <TeamDetailsModal teamId={modal.team.id} onClose={closeModal} />}
      {modal && modal.type === 'rename' && (
        <RenameTeamModal
          team={modal.team}
          onClose={closeModal}
          onSaved={updated => {
            setData(d => ({ ...d, teams: d.teams.map(t => (t.id === updated.id ? updated : t)) }));
            closeModal();
          }}
        />
      )}
      {modal && modal.type === 'reset' && <ResetPasswordModal team={modal.team} onClose={closeModal} />}
      {modal && modal.type === 'delete' && <DeleteTeamModal team={modal.team} onClose={closeModal} onDeleted={() => { closeModal(); load(); }} />}
    </>
  );
}
