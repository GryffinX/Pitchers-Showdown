import React, { useEffect } from 'react';
import '../styles/GameToast.css';

const DURATION_MS = 4000;

// In-page notification for player actions. Pass a new `toast` object ({ id, type, title, message })
// to show it; it hides itself after a few seconds or when closed, and never blocks the page.
export default function GameToast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  const success = toast.type === 'success';

  return (
    <div className="game-toast-region">
      <div
        key={toast.id}
        className={`game-toast game-toast-${success ? 'success' : 'error'}`}
        role={success ? 'status' : 'alert'}
        aria-live={success ? 'polite' : 'assertive'}
      >
        <span className="game-toast-icon" aria-hidden="true">{success ? '✓' : '!'}</span>
        <div className="game-toast-body">
          <div className="game-toast-title">{toast.title}</div>
          {toast.message && <div className="game-toast-message">{toast.message}</div>}
        </div>
        <button type="button" className="game-toast-close" onClick={onClose} aria-label="Dismiss notification">×</button>
        <span className="game-toast-timer" style={{ animationDuration: `${DURATION_MS}ms` }} aria-hidden="true" />
      </div>
    </div>
  );
}
