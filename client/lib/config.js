// Set VITE_API_URL in Vercel (or client/.env.local) to point the app at another API
export const API_URL = (import.meta.env.VITE_API_URL || 'https://pitchers-showdown.onrender.com').replace(/\/+$/, '');
