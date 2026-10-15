import React, { useEffect } from 'react';

export default function Modal({ title, onClose, children, footer, wide = false, busy = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div className="adm-modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className={`adm-modal ${wide ? 'adm-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="adm-modal-head">
          <h2>{title}</h2>
          <button className="adm-icon-btn" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <div className="adm-modal-body">{children}</div>
        {footer && <div className="adm-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
