import React from 'react';

export const Spinner = ({ label = 'Loading…' }) => (
  <div className="adm-state"><span className="adm-spinner" aria-hidden="true" />{label}</div>
);

export const ErrorState = ({ message, onRetry }) => (
  <div className="adm-state adm-state-error">
    <span>{message}</span>
    {onRetry && <button className="adm-btn adm-btn-ghost" onClick={onRetry}>Retry</button>}
  </div>
);

export const EmptyState = ({ children }) => <div className="adm-state adm-muted">{children}</div>;
