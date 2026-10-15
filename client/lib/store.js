import { create } from 'zustand';

const TOKEN_KEY = 'token';

// Keep players signed in across page reloads. The balance is not saved: it is loaded
// from the server again (see SessionSync in App.jsx), because it changes as teams invest.
const readSavedToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || undefined; } catch { return undefined; }
};
const savedToken = readSavedToken();

const useAuthStore = create((set) => ({
  auth: {
    is_logged: Boolean(savedToken),
    user: savedToken,
  },
  balance: 0,

  setBalance: (newBalance) => set(() => ({
    balance: newBalance
  })),
  login: (user, balance) =>
    set(() => ({
      auth: {
        is_logged: true,
        user,
      },
      balance,
    })),
  logout: () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
    set(() => ({
      auth: {
        is_logged: false,
        user: undefined,
      },
      balance: 0,
    }));
  },
}));

export default useAuthStore;
