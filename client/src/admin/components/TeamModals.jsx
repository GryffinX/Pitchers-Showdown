import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import { Spinner, ErrorState, EmptyState } from './States';
import { adminRequest, formatDate, formatMoney, generatePassword } from '../adminApi';
import { useToast } from './toastContext';

// Mirrors server/services/teamService.js so most mistakes are caught before submitting
const USERNAME_RE = /^[A-Za-z0-9_.@-]{3,64}$/;
const checkPassword = (password, confirm) => {
  if (password.length < 6 || new TextEncoder().encode(password).length > 72) return 'Password must be 6-72 characters.';
  if (password !== confirm) return 'Passwords do not match.';
  return '';
};

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; value is visible to copy by hand */ }
  };
  return <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={copy}>{copied ? 'Copied' : label}</button>;
}

// Shown once after create/reset so the admin can hand the credentials to the team
function Credentials({ username, password }) {
  return (
    <div className="adm-credentials">
      <p className="adm-muted adm-small">Share these with the team now — the password can&apos;t be shown again.</p>
      <div className="adm-cred-row"><span>Username</span><code>{username}</code><CopyButton value={username} /></div>
      <div className="adm-cred-row"><span>Password</span><code>{password}</code><CopyButton value={password} /></div>
      <CopyButton value={`Username: ${username}\nPassword: ${password}`} label="Copy both" />
    </div>
  );
}

function PasswordFields({ password, confirm, setPassword, setConfirm, disabled }) {
  const [show, setShow] = useState(false);
  const generate = () => {
    const p = generatePassword();
    setPassword(p);
    setConfirm(p);
    setShow(true);
  };
  return (
    <>
      <label className="adm-field">
        <span>Password</span>
        <div className="adm-input-group">
          <input className="adm-input" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} disabled={disabled} />
          <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => setShow(s => !s)} disabled={disabled}>{show ? 'Hide' : 'Show'}</button>
          <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={generate} disabled={disabled}>Generate</button>
        </div>
      </label>
      <label className="adm-field">
        <span>Confirm password</span>
        <input className="adm-input" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={disabled} />
      </label>
    </>
  );
}

export function CreateTeamModal({ onClose, onCreated }) {
  const notify = useToast();
  const [form, setForm] = useState({ name: '', username: '' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const username = form.username.trim();
    if (!name) return setError('Team name is required.');
    if (!USERNAME_RE.test(username)) return setError('Username must be 3-64 characters: letters, numbers, _ . @ -');
    const pwError = checkPassword(password, confirm);
    if (pwError) return setError(pwError);

    setBusy(true);
    setError('');
    try {
      const data = await adminRequest('/teams', { method: 'POST', body: { name, username, password } });
      setCreated({ username: data.team.username, password });
      notify(`Team “${data.team.name}” created`);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal title="Team created" onClose={onClose} footer={<button className="adm-btn adm-btn-primary" onClick={onClose}>Done</button>}>
        <Credentials {...created} />
      </Modal>
    );
  }

  return (
    <Modal
      title="New team"
      onClose={onClose}
      busy={busy}
      footer={<>
        <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="adm-btn adm-btn-primary" type="submit" form="create-team" disabled={busy}>{busy ? 'Creating…' : 'Create team'}</button>
      </>}
    >
      <form id="create-team" className="adm-form" onSubmit={submit} noValidate>
        {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}
        <label className="adm-field">
          <span>Team name</span>
          <input className="adm-input" value={form.name} maxLength={60} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} disabled={busy} autoFocus />
        </label>
        <label className="adm-field">
          <span>Username <em className="adm-muted">used to log in</em></span>
          <input className="adm-input" value={form.username} maxLength={64} autoComplete="off" onChange={e => setForm(f => ({ ...f, username: e.target.value }))} disabled={busy} />
        </label>
        <PasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} disabled={busy} />
        <p className="adm-muted adm-small">The team starts with the standard purse and can log in on the player site immediately.</p>
      </form>
    </Modal>
  );
}

export function RenameTeamModal({ team, onClose, onSaved }) {
  const notify = useToast();
  const [name, setName] = useState(team.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Team name is required.');
    setBusy(true);
    setError('');
    try {
      const data = await adminRequest(`/teams/${team.id}`, { method: 'PATCH', body: { name: name.trim() } });
      notify(`Renamed to “${data.team.name}”`);
      onSaved(data.team);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Rename team"
      onClose={onClose}
      busy={busy}
      footer={<>
        <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="adm-btn adm-btn-primary" type="submit" form="rename-team" disabled={busy || name.trim() === team.name}>{busy ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <form id="rename-team" className="adm-form" onSubmit={submit} noValidate>
        {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}
        <p className="adm-muted">Username <strong>{team.username}</strong> stays the same.</p>
        <label className="adm-field">
          <span>Team name</span>
          <input className="adm-input" value={name} maxLength={60} onChange={e => setName(e.target.value)} disabled={busy} autoFocus />
        </label>
      </form>
    </Modal>
  );
}

export function ResetPasswordModal({ team, onClose }) {
  const notify = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const pwError = checkPassword(password, confirm);
    if (pwError) return setError(pwError);
    setBusy(true);
    setError('');
    try {
      await adminRequest(`/teams/${team.id}/reset-password`, { method: 'POST', body: { password } });
      notify(`Password reset for ${team.username}`);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal title="Password reset" onClose={onClose} footer={<button className="adm-btn adm-btn-primary" onClick={onClose}>Done</button>}>
        <Credentials username={team.username} password={password} />
      </Modal>
    );
  }

  return (
    <Modal
      title="Reset password"
      onClose={onClose}
      busy={busy}
      footer={<>
        <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="adm-btn adm-btn-primary" type="submit" form="reset-password" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
      </>}
    >
      <form id="reset-password" className="adm-form" onSubmit={submit} noValidate>
        {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}
        <div className="adm-target">
          <div className="adm-strong">{team.name}</div>
          <div className="adm-muted">{team.username}</div>
        </div>
        <PasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} disabled={busy} />
        <div className="adm-alert adm-alert-info">The team will be signed out on every device and must log in with the new password.</div>
      </form>
    </Modal>
  );
}

export function DeleteTeamModal({ team, onClose, onDeleted }) {
  const notify = useToast();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (typed !== team.username) return;
    setBusy(true);
    setError('');
    try {
      await adminRequest(`/teams/${team.id}`, { method: 'DELETE', body: { confirmUsername: typed } });
      notify(`Team “${team.name}” deleted`);
      onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Delete team"
      onClose={onClose}
      busy={busy}
      footer={<>
        <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="adm-btn adm-btn-danger" type="submit" form="delete-team" disabled={busy || typed !== team.username}>{busy ? 'Deleting…' : 'Delete team'}</button>
      </>}
    >
      <form id="delete-team" className="adm-form" onSubmit={submit} noValidate>
        {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}
        <div className="adm-target adm-target-danger">
          <div className="adm-strong">{team.name}</div>
          <div className="adm-muted">{team.username} · {formatMoney(team.balance)} left</div>
        </div>
        <ul className="adm-bullets">
          <li>The team is signed out and can no longer log in.</li>
          <li>It disappears from the Teams page, so nobody can invest in it.</li>
          <li>Investments it made and received are kept, so other teams&apos; balances don&apos;t change.</li>
          <li>There is no restore button in the dashboard, and the username stays taken.</li>
        </ul>
        <label className="adm-field">
          <span>Type <strong>{team.username}</strong> to confirm</span>
          <input className="adm-input" value={typed} autoComplete="off" onChange={e => setTyped(e.target.value)} disabled={busy} autoFocus />
        </label>
      </form>
    </Modal>
  );
}

// The score as a plain decimal (0.4 stays 0.4, 2 stays 2). Six decimal places is enough to show
// every real difference while hiding floating-point noise like 0.30000000000000004.
// eslint-disable-next-line react-refresh/only-export-components
export const formatScore = (value) => String(Number(Number(value).toFixed(6)));

function InvestmentTable({ rows, column }) {
  if (rows.length === 0) return <EmptyState>None.</EmptyState>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table adm-table-compact">
        <thead><tr><th>{column}</th><th className="adm-right">Amount</th></tr></thead>
        <tbody>
          {rows.map(inv => (
            <tr key={inv.id}>
              <td>
                {inv.team ? <>{inv.team.name} <span className="adm-muted">{inv.team.username}</span></> : <span className="adm-muted">Unknown team</span>}
                {inv.team && inv.team.deleted && <span className="adm-badge adm-badge-failure adm-badge-inline">deleted</span>}
              </td>
              <td className="adm-right">{formatMoney(inv.amt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Rupee-like amounts (IR, profit) keep up to 2 decimals; ratios and points use formatScore
const formatAmount = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Every value that goes into the team's points, worked through step by step
function ScoreCalculation({ calc }) {
  const w = calc.weights;
  const floorNote = (max) => (max === 1 ? ' (minimum 1, avoids dividing by 0)' : '');
  return (
    <section className="adm-calc">
      <h3>Points calculation</h3>
      <p className="adm-muted adm-small">
        Points = {w.IR} × (IR ÷ max IR) + {w.PI} × (profit ÷ max profit) + admin points.
        IR is the total investment this team received. Recalculated live from the database; only admins see it.
      </p>

      <div className="adm-calc-inputs">
        <div className="adm-calc-group">
          <div className="adm-calc-group-title">This team</div>
          <dl>
            <div><dt>IR (investment received)</dt><dd>{formatAmount(calc.received)}</dd></div>
            <div><dt>Profit from investments</dt><dd>{formatAmount(calc.profit)}</dd></div>
            <div><dt>Admin points</dt><dd>{formatScore(calc.adminPoints)}</dd></div>
          </dl>
        </div>
        <div className="adm-calc-group">
          <div className="adm-calc-group-title">All {calc.teamCount} active teams</div>
          <dl>
            <div><dt>Max IR</dt><dd>{formatAmount(calc.maxReceived)}{floorNote(calc.maxReceived)}</dd></div>
            <div><dt>Max profit</dt><dd>{formatAmount(calc.maxProfit)}{floorNote(calc.maxProfit)}</dd></div>
            <div><dt>Total IR</dt><dd>{formatAmount(calc.totalReceived)}</dd></div>
            <div><dt>Average IR</dt><dd>{formatAmount(calc.averageReceived)}</dd></div>
          </dl>
        </div>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact adm-calc-steps">
          <thead><tr><th>Part</th><th>Calculation</th><th className="adm-right">Value</th></tr></thead>
          <tbody>
            <tr>
              <td>Investment received</td>
              <td className="adm-mono adm-small">{w.IR} × ({formatAmount(calc.received)} ÷ {formatAmount(calc.maxReceived)}) = {w.IR} × {formatScore(calc.receivedRatio)}</td>
              <td className="adm-right">{formatScore(calc.receivedPart)}</td>
            </tr>
            <tr>
              <td>Profit</td>
              <td className="adm-mono adm-small">{w.PI} × ({formatAmount(calc.profit)} ÷ {formatAmount(calc.maxProfit)}) = {w.PI} × {formatScore(calc.profitRatio)}</td>
              <td className="adm-right">{formatScore(calc.profitPart)}</td>
            </tr>
            <tr>
              <td>Admin points</td>
              <td className="adm-muted adm-small">added as they are (revoked points don&apos;t count)</td>
              <td className="adm-right">{formatScore(calc.adminPoints)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="adm-strong">Total points</td>
              <td className="adm-mono adm-small">{formatScore(calc.receivedPart)} + {formatScore(calc.profitPart)} + {formatScore(calc.adminPoints)}</td>
              <td className="adm-right adm-calc-final" title={String(calc.final)}>{formatScore(calc.final)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className="adm-calc-sub">How the profit is made up</h3>
      {calc.profitItems.length === 0 ? (
        <EmptyState>This team hasn&apos;t invested, so its profit is 0.</EmptyState>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-table-compact">
            <thead>
              <tr>
                <th>Invested in</th>
                <th className="adm-right">Amount</th>
                <th className="adm-right">That team&apos;s IR</th>
                <th>Calculation</th>
                <th className="adm-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {calc.profitItems.map(item => (
                <tr key={item.id}>
                  <td>
                    {item.team || <span className="adm-muted">Unknown team</span>}
                    {item.deleted && <span className="adm-badge adm-badge-failure adm-badge-inline">deleted</span>}
                  </td>
                  <td className="adm-right">{formatAmount(item.amt)}</td>
                  <td className="adm-right">{formatAmount(item.teamReceived)}</td>
                  <td className="adm-mono adm-small">{formatAmount(item.amt)} × ({formatAmount(item.teamReceived)} ÷ {formatAmount(calc.averageReceived)})</td>
                  <td className="adm-right">{formatAmount(item.profit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="adm-strong" colSpan={4}>Total profit</td>
                <td className="adm-right adm-strong">{formatAmount(calc.profit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

export function TeamDetailsModal({ teamId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminRequest(`/teams/${teamId}`).then(setData).catch(err => setError(err.message));
  }, [teamId]);

  return (
    <Modal title="Team details" onClose={onClose} wide footer={<button className="adm-btn adm-btn-ghost" onClick={onClose}>Close</button>}>
      {error ? <ErrorState message={error} /> : !data ? <Spinner /> : (
        <>
          <dl className="adm-details">
            <div><dt>Team name</dt><dd>{data.team.name}</dd></div>
            <div>
              <dt>Points</dt>
              <dd className="adm-strong" title={data.team.score ? String(data.team.score.value) : undefined}>
                {data.team.score ? formatScore(data.team.score.value) : <span className="adm-muted">Not scored (deleted)</span>}
              </dd>
            </div>
            <div><dt>Username</dt><dd>{data.team.username}</dd></div>
            <div><dt>Status</dt><dd><span className={`adm-badge adm-badge-${data.team.status}`}>{data.team.status}</span>{data.team.deletedAt && <span className="adm-muted adm-small"> {formatDate(data.team.deletedAt)}</span>}</dd></div>
            <div><dt>Remaining balance</dt><dd>{formatMoney(data.team.balance)}</dd></div>
            <div><dt>Invested</dt><dd>{formatMoney(data.totalInvested)}</dd></div>
            <div><dt>Received</dt><dd>{formatMoney(data.totalReceived)}</dd></div>
            <div><dt>Created</dt><dd>{formatDate(data.team.createdAt)}</dd></div>
            <div><dt>Account ID</dt><dd className="adm-mono adm-small">{data.team.id}</dd></div>
          </dl>
          {data.calculation
            ? <ScoreCalculation calc={data.calculation} />
            : <div className="adm-alert adm-alert-info adm-calc-gap">Deleted teams are not scored. Admin points on record: {formatScore(data.team.points || 0)}.</div>}
          <div className="adm-grid-2 adm-grid-tight">
            <section>
              <h3>Invested in ({data.investmentsMade.length})</h3>
              <InvestmentTable rows={data.investmentsMade} column="Team" />
            </section>
            <section>
              <h3>Received from ({data.investmentsReceived.length})</h3>
              <InvestmentTable rows={data.investmentsReceived} column="Investor" />
            </section>
          </div>
        </>
      )}
    </Modal>
  );
}

// Mirrors the limits in server/controllers/adminController.js
const MAX_POINTS = 100000;
const MAX_REASON = 120;
const checkPoints = (text) => {
  const n = Number(text);
  if (text.trim() === '' || !Number.isInteger(n) || n === 0 || Math.abs(n) > MAX_POINTS)
    return `Enter a whole number between -${MAX_POINTS.toLocaleString('en-IN')} and ${MAX_POINTS.toLocaleString('en-IN')}, not 0.`;
  return '';
};
const formatPoints = (n) => `${n > 0 ? '+' : ''}${Number(n).toLocaleString('en-IN')}`;

function PointsRow({ award, editable, busy, onSave, onToggle }) {
  const [editing, setEditing] = useState(false);
  const [points, setPoints] = useState(String(award.points));
  const [reason, setReason] = useState(award.reason);
  const [error, setError] = useState('');

  const startEdit = () => {
    setPoints(String(award.points));
    setReason(award.reason);
    setError('');
    setEditing(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const pointsError = checkPoints(points);
    if (pointsError) return setError(pointsError);
    if (await onSave(award, { points: Number(points), reason: reason.trim() }, setError)) setEditing(false);
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={4}>
          <form className="adm-points-edit" onSubmit={save} noValidate>
            <input className="adm-input adm-points-input" type="number" step="1" value={points} onChange={e => setPoints(e.target.value)} disabled={busy} aria-label="Points" autoFocus />
            <input className="adm-input" value={reason} maxLength={MAX_REASON} onChange={e => setReason(e.target.value)} disabled={busy} placeholder="Reason (optional)" aria-label="Reason" />
            <button className="adm-btn adm-btn-primary adm-btn-sm" type="submit" disabled={busy}>Save</button>
            <button className="adm-btn adm-btn-ghost adm-btn-sm" type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </form>
          {error && <div className="adm-alert adm-alert-error adm-points-error" role="alert">{error}</div>}
        </td>
      </tr>
    );
  }

  return (
    <tr className={award.revoked ? 'adm-points-revoked' : ''}>
      <td className={`adm-nowrap adm-strong ${award.points > 0 ? 'adm-points-plus' : 'adm-points-minus'}`}>{formatPoints(award.points)}</td>
      <td>
        {award.reason || <span className="adm-muted">No reason given</span>}
        {award.revoked && <span className="adm-badge adm-badge-failure adm-badge-inline">revoked</span>}
      </td>
      <td className="adm-nowrap adm-muted adm-small">
        {formatDate(award.createdAt)}
        {award.editedAt && <div>edited {formatDate(award.editedAt)}</div>}
      </td>
      <td className="adm-right">
        {editable && (
          <div className="adm-row-actions">
            {!award.revoked && <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={startEdit} disabled={busy}>Edit</button>}
            {award.revoked
              ? <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => onToggle(award, false)} disabled={busy}>Restore</button>
              : <button className="adm-btn adm-btn-danger-ghost adm-btn-sm" onClick={() => onToggle(award, true)} disabled={busy}>Revoke</button>}
          </div>
        )}
      </td>
    </tr>
  );
}

// Give or take points by hand. Every entry can be edited, revoked (no longer counted) and restored.
export function PointsModal({ team, onClose }) {
  const notify = useToast();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminRequest(`/teams/${team.id}/points`).then(setData).catch(err => setLoadError(err.message));
  }, [team.id]);

  const apply = setData;

  const add = async (e) => {
    e.preventDefault();
    const pointsError = checkPoints(points);
    if (pointsError) return setError(pointsError);
    setBusy(true);
    setError('');
    try {
      apply(await adminRequest(`/teams/${team.id}/points`, { method: 'POST', body: { points: Number(points), reason: reason.trim() } }));
      notify(`${formatPoints(Number(points))} points for “${team.name}”`);
      setPoints('');
      setReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (award, body, setRowError) => {
    setBusy(true);
    try {
      apply(await adminRequest(`/points/${award.id}`, { method: 'PATCH', body }));
      notify('Points entry updated');
      return true;
    } catch (err) {
      setRowError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (award, revoked) => {
    setBusy(true);
    setError('');
    try {
      apply(await adminRequest(`/points/${award.id}`, { method: 'PATCH', body: { revoked } }));
      notify(`${revoked ? 'Revoked' : 'Restored'} ${formatPoints(award.points)} points`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const editable = team.status === 'active';

  return (
    <Modal title="Points" onClose={onClose} wide busy={busy} footer={<button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={busy}>Close</button>}>
      <div className="adm-points-head">
        <div className="adm-target">
          <div className="adm-strong">{team.name}</div>
          <div className="adm-muted">{team.username}</div>
        </div>
        <div className="adm-points-total">
          <span className="adm-muted adm-small">Admin points</span>
          <strong>{data ? data.total.toLocaleString('en-IN') : '—'}</strong>
        </div>
      </div>

      {editable ? (
        <form className="adm-points-add" onSubmit={add} noValidate>
          <label className="adm-field">
            <span>Points <em className="adm-muted">negative takes away</em></span>
            <input className="adm-input adm-points-input" type="number" step="1" placeholder="e.g. 50" value={points} onChange={e => setPoints(e.target.value)} disabled={busy || !data} autoFocus />
          </label>
          <label className="adm-field adm-points-reason">
            <span>Reason <em className="adm-muted">optional</em></span>
            <input className="adm-input" placeholder="e.g. Best pitch, round 1" value={reason} maxLength={MAX_REASON} onChange={e => setReason(e.target.value)} disabled={busy || !data} />
          </label>
          <button className="adm-btn adm-btn-primary" type="submit" disabled={busy || !data}>{busy ? 'Saving…' : 'Add points'}</button>
        </form>
      ) : (
        <div className="adm-alert adm-alert-info">This team is deleted, so its points can be viewed but not changed.</div>
      )}
      {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}

      <h3 className="adm-points-history">History</h3>
      {loadError ? <ErrorState message={loadError} /> : !data ? <Spinner /> : data.awards.length === 0 ? (
        <EmptyState>No points given yet.</EmptyState>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-table-compact">
            <thead><tr><th>Points</th><th>Reason</th><th>Added</th><th className="adm-right">Actions</th></tr></thead>
            <tbody>
              {data.awards.map(award => (
                <PointsRow key={award.id} award={award} editable={editable} busy={busy} onSave={save} onToggle={toggle} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="adm-muted adm-small adm-points-note">Revoked entries stay in the history but don&apos;t count towards the total. Restore one to count it again.</p>
    </Modal>
  );
}
