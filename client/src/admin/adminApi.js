import { API_URL } from '../../lib/config';

// Admin token lives in sessionStorage (per tab, cleared when the tab closes),
// fully separate from the player token in the zustand store / localStorage
const KEY = 'ps_admin_token';

export const adminSession = {
  get() {
    try { return sessionStorage.getItem(KEY); } catch { return null; }
  },
  set(token) {
    try { sessionStorage.setItem(KEY, token); } catch { /* storage unavailable */ }
  },
  clear() {
    try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  },
};

export const UNAUTHORIZED_EVENT = 'ps-admin-unauthorized';

export class AdminApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Used when the response has no JSON { error } (e.g. a proxy or platform error page)
const fallbackMessage = (status) => {
  if (status === 401) return 'Invalid admin credentials or session.';
  if (status === 404) return 'The admin API was not found on this server. Is the latest backend deployed?';
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (status === 503) return 'Admin sign-in is unavailable: the server is not configured for admin access or is temporarily down.';
  if (status >= 500) return `The server hit an error (${status}). Try again shortly.`;
  return `Request failed (${status}).`;
};

export async function adminRequest(path, { method = 'GET', body, query } = {}) {
  const token = adminSession.get();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let url = `${API_URL}/api/admin${path}`;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== '') params.set(k, v); });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    // fetch only rejects when no readable response arrives: offline, DNS, a stopped/suspended
    // host, or a response without CORS headers. HTTP error statuses are handled below.
    throw new AdminApiError(`Could not reach the API at ${new URL(API_URL).host}. The server may be down, starting up, or not allowing this site (CORS).`, 0);
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && path !== '/login') {
    adminSession.clear();
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: data.error }));
  }
  if (!res.ok) throw new AdminApiError(data.error || fallbackMessage(res.status), res.status);
  return data;
}

export const formatMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export const formatDate = (d) => d
  ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

export function generatePassword(length = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}
