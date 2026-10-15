import React from 'react';

export default function Pagination({ page, pages, total, noun, plural, onChange }) {
  return (
    <div className="adm-pagination">
      <span className="adm-muted">{total.toLocaleString('en-IN')} {total === 1 ? noun : (plural || `${noun}s`)}</span>
      <div className="adm-pagination-controls">
        <button className="adm-btn adm-btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Prev</button>
        <span>Page {page} of {pages}</span>
        <button className="adm-btn adm-btn-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}
