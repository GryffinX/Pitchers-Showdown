import React, { useCallback, useState } from 'react';
import { ToastContext } from './toastContext';

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts(list => list.filter(t => t.id !== id)), []);

  const notify = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list, { id, message, type }]);
    setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="adm-toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`adm-toast adm-toast-${t.type}`}>
            <span>{t.message}</span>
            <button className="adm-icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
