import React from 'react';
import "../styles/Homepage.css";
import { Link } from 'react-router-dom'
import useAuthStore from '../../lib/store';

function Title() {
  const isLoggedIn = useAuthStore((state) => state.auth.is_logged);

  return (
    <div className="title-container min-h-[60vh] peralta-regular flex flex-wrap justify-center content-center">
      <div className="pitchers-text">THE PITCHER&apos;S</div>
      <div className="showdown-text">SHOWDOWN!</div>
      {!isLoggedIn && (
        <Link to='/login'>
          <button className="login-button">
            Log in
          </button>
        </Link>
      )}
    </div>
  );
}

export default Title;
