import './App.css'

import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import PrivateRoute from './components/PrivateRouter';
import useAuthStore from '../lib/store';
import { API_URL } from '../lib/config';
import { logoutPlayer } from '../lib/api';
import Homepage from './pages/Homepage'
import Login from './pages/Login';
import Profile from './pages/Profile';
import Teams from './pages/Teams';
import BusinessPage from './pages/BusinessPage';

// Admin console is only reachable by typing /admin; loaded on demand so players never download it
const AdminLogin = lazy(() => import('./admin/pages/AdminLogin'));
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./admin/pages/AdminDashboard'));
const AdminTeams = lazy(() => import('./admin/pages/AdminTeams'));

// When a saved session is restored on page load, fetch the current balance (it is not saved locally)
// and sign out if the server no longer accepts the token
function SessionSync() {
  const token = useAuthStore(state => state.auth.user);

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    fetch(`${API_URL}/api/profile`, { headers: { 'x-access-token': token }, signal: controller.signal })
      .then(async res => {
        if (res.status === 401 || res.status === 403) {
          if (useAuthStore.getState().auth.user === token) useAuthStore.getState().logout();
          return;
        }
        const data = res.ok ? await res.json() : null;
        if (data && typeof data.balance === 'number') useAuthStore.getState().setBalance(data.balance);
      })
      .catch(() => { /* offline or server down: keep the session and try again on the next load */ });
    return () => controller.abort();
  }, [token]);

  return null;
}

function PlayerHeader() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore(state => state.auth.user);
  const isLoggedIn = useAuthStore(state => state.auth.is_logged);
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return null;

  const logout = () => {
    logoutPlayer(token);
    useAuthStore.getState().logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className='fixed top-0 start-0 end-0 py-5 px-10 bg-[rgba(0,0,0,0.75)] z-999 flex justify-center sm:justify-end'>
      <nav className='nav' style={{ display: 'inline-flex' }}>
        <Link to='/'>Home</Link>
        <Link to='/teams'>Teams</Link>
        <Link to='/profile'>Investments</Link>
        {isLoggedIn && <button type='button' className='logout-nav' onClick={logout}>Logout</button>}
      </nav>
    </header>
  );
}

function App() {
  return (
    <BrowserRouter>
      <SessionSync />
      <PlayerHeader />
      <Suspense fallback={null}>
        <Routes>
          <Route path='/' element={<Homepage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
          <Route path="/teams" element={<Teams />} />
          <Route path="teams/:teamId" element={<PrivateRoute><BusinessPage /></PrivateRoute>} />

          <Route path="/admin" element={<AdminLogin />} />
          <Route element={<AdminLayout />}>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/teams" element={<AdminTeams />} />
          </Route>
          <Route path="/admin/*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
export default App
