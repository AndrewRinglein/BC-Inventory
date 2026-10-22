import React from 'react';

/**
 * Several games match what was scanned or typed — the same pick list the Frontier
 * admin box scanner shows. Picking one makes it the game waiting for its serial.
 */
export default function GamePickModal({ matches, onPick, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Which game?</div>
        {matches.map((m) => (
          <button key={m.id} className="btn ghost" onClick={() => onPick(m)}
            style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 6, textAlign: 'left' }}>
            <b>{m.name}</b>
            <span className="dimmer mono" style={{ fontSize: 12 }}>
              form {m.form_number} · {Number(m.tickets || 0).toLocaleString()} tickets
            </span>
          </button>
        ))}
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
