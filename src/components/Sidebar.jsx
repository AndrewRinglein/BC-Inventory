import React, { useContext } from 'react';
import { AppCtx } from '../App.jsx';
import { productsNeedingUpdate } from '../lib/logic/setup.js';

export default function Sidebar() {
  const { screen, setScreen, payments, pos, products, boxes, store, role, roleLabel, can, IS_SANDBOX } = useContext(AppCtx);
  const demoHref = (on) => {
    const u = new URL(window.location.href);
    if (on) u.searchParams.set('demo', ''); else u.searchParams.delete('demo');
    return u.pathname + '?' + u.searchParams.toString().replace(/=(&|$)/g, '$1');
  };
  const openPay = payments.filter((p) => p.status === 'open').length;
  const openPos = pos.filter((p) => p.status === 'sent' || p.status === 'partial').length;
  const openBoxes = boxes.filter((b) => b.state === 'opened').length;
  const toUpdate = productsNeedingUpdate(products).length;

  const Item = ({ id, label, badge, gold, title }) => (
    <div className={'nav-item' + (screen === id ? ' active' : '')} onClick={() => setScreen(id)} title={title || ''}>
      <span>{label}</span>
      {badge ? <span className={'nav-badge' + (gold ? ' gold' : '')}>{badge}</span> : null}
    </div>
  );

  return (
    <div className="sidebar no-print">
      <div className="sb-title">BC Inventory</div>
      <div style={{ padding: '0 6px', marginBottom: 6 }}>
        <span className={'badge ' + ({ admin: 'b-teal', accountant: 'b-gold', floor: 'b-green' }[role] || 'b-gray')}>{roleLabel}</span>
      </div>
      <Item id="purchase" label="Purchase" />
      <Item id="receive" label="Receive" title="Check in a delivery by scanning each box" />
      <Item id="open" label="Open" badge={openBoxes || null}
        title="Scan boxes onto the floor; sold out, remainder or close unsold" />
      <Item id="reports" label="Reports" title="Compliance report: every box opened and closed, by day, range or month" />
      <Item id="progressives" label="Progressives" title="Every progressive jackpot, and the full-screen TV display" />
      <div className="sb-sec">Track</div>
      <Item id="inventory" label="Inventory" />
      <Item id="orders" label="Open Orders" badge={openPos || null} />
      <Item id="accounting" label="Accounting" badge={openPay || null} />
      <Item id="history" label="History" title="Everything that has happened — receives, opens, closes, orders, adjustments" />
      <Item id="dashboard" label="Dashboard" />
      <div className="sb-sec">Admin</div>
      <Item id="games" label={can('editCatalog') ? 'Add / Update Games' : 'Game Catalog'}
        badge={toUpdate || null} gold
        title={toUpdate ? `${toUpdate} game${toUpdate === 1 ? '' : 's'} have a blank cost, ticket count, form number or distributor` : ''} />
      {can('settings') && <Item id="settings" label="Settings" />}
      <div className="sb-sec">Training</div>
      {IS_SANDBOX ? (
        <a className="nav-item" style={{ textDecoration: 'none', color: '#8a6d1f', fontWeight: 600 }} href={demoHref(false)}>← Exit training</a>
      ) : (
        <a className="nav-item" style={{ textDecoration: 'none' }} href={demoHref(true)} title="Sandbox with fake data at every stage — never touches real inventory">🎓 Demo / Training</a>
      )}
      <div style={{ marginTop: 22, padding: '0 6px' }}>
        <button className="btn ghost sm" style={{ width: '100%' }}
          onClick={async () => { await store.signOut(); location.reload(); }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
