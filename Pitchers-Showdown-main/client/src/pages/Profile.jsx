import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/Profile.css';
import background from '../assets/background_profile.png';
import useAuthStore from '../../lib/store';
import { API_URL } from '../../lib/config';

function InvestmentSection({ title, items, empty }) {
  return (
    <section className='investSection' aria-label={title}>
      <div className='sectionTitle'>{title}</div>
      {items.length === 0 ? (
        <div className='emptyState'>{empty}</div>
      ) : items.map((inv, i) => (
        <div className='item' key={`${i}-${inv.team}`}>
          <div className='teamName'>
            {inv.team || 'Unknown team'}
            {inv.teamDeleted && <span className='teamRemoved'>removed</span>}
          </div>
          <div className='amount'>{inv.amt.toLocaleString()}</div>
        </div>
      ))}
    </section>
  );
}

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const timerRef = useRef(null);

  const token = useAuthStore(state => state.auth.user)
  const balance = useAuthStore(state => state.balance)

  useEffect(() => {
    const controller = new AbortController();
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${API_URL}/api/profile`, {
            method: 'GET',
            headers: {'x-access-token': token },
            signal: controller.signal,
            mode: 'cors'
         });
        if (!res.ok) {
          throw new Error(`Failed to fetch profile (${res.status})`);
        }
        const data = await res.json();
        setProfile(data);
        // the server's balance is the source of truth (the login-time value may be stale)
        if (typeof data.balance === 'number') useAuthStore.getState().setBalance(data.balance);
        setError('');
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError('Could not load profile. Redirecting to login...');
        timerRef.current = setTimeout(() => {
          navigate('/login', { replace: true });
        }, 5000); 
      }
    };

    fetchProfile();

    return () => {
      controller.abort();
      if (timerRef.current) {
          clearTimeout(timerRef.current);
      }
    };
  }, [navigate, token]);

  if (error) return <div className="profile-error">{error}</div>;
  if (!profile) 
    return (
    <div
      style={{
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundImage: `url(${background})`,
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            display: 'grid',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 0,
            overflow: 'hidden',
        }} >
        <div className='card'>
            <center>
            <div className='header'>
              Loading...
            </div>
            </center>
        </div>
    </div>
  );

  return (
    <div
      style={{
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundImage: `url(${background})`,
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            display: 'grid',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 0,
            overflow: 'hidden',
  }}
    >

      <main className='centerWrap'>
        <div className='card'>
            <div className='header'>
              Your Investments!
            </div>
            <div className='subheader'> 
              Remaining Investment Amount: {(profile.balance ?? balance).toLocaleString()}
            </div>
          <div className='listWrap'>
            <div className='list'>
              <InvestmentSection
                title='Teams you invested in'
                items={profile.investments}
                empty="You haven't invested in any teams yet."
              />
              {Array.isArray(profile.received) && (
                <InvestmentSection
                  title='Investments received'
                  items={profile.received}
                  empty='No team has invested in you yet.'
                />
              )}
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}