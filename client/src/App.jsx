import './App.css'

import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import PrivateRoute from './components/PrivateRouter';
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

function PlayerHeader() {
  const { pathname } = useLocation();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return null;

  return (
    <header className='fixed top-0 start-0 end-0 py-5 px-10 bg-[rgba(0,0,0,0.75)] z-999 flex justify-center sm:justify-end'>
      <nav className='nav' style={{ display: 'inline-flex' }}>
        <Link to='/'>Home</Link>
        <Link to='/teams'>Teams</Link>
        <Link to='/profile'>Investments</Link>
      </nav>
    </header>
  );
}

function App() {
  return (
    <BrowserRouter>
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
