// Role system — role comes from the URL (?role=...), as in the bingo app this was
// copied from. A shared site password still gates entry; the link picks what the
// person can DO. Distribute one link per person:
//
//   https://yourapp.com/?role=admin        Admin — everything
//   https://yourapp.com/?role=floor        Floor / inventory — order, receive, open, report
//   https://yourapp.com/?role=accountant   Accountant — read all, reports, mark invoices paid
//
// Add &demo to any link for the staged sandbox: https://yourapp.com/?role=admin&demo
//
// BC is one location. The hall id 'bc' is kept internally so every query that
// filters by hall keeps working; nobody ever picks a hall.

export const HALL_ID = 'bc';
export const HALL_NAME = 'BC';

export const ROLES = {
  admin:      { label: 'Admin',            home: HALL_ID, badge: 'b-teal' },
  floor:      { label: 'Floor / Inventory', home: HALL_ID, badge: 'b-green' },
  accountant: { label: 'Accountant',       home: HALL_ID, badge: 'b-gold' },
};

export function roleFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const r = p.get('role');
  return ROLES[r] ? r : null;    // null -> show the role picker
}

export function demoFromUrl() {
  return new URLSearchParams(window.location.search).has('demo');
}

export function roleLink(roleId, demo) {
  const u = new URL(window.location.href);
  u.searchParams.set('role', roleId);
  if (demo) u.searchParams.set('demo', '');
  else u.searchParams.delete('demo');
  return u.pathname + '?' + u.searchParams.toString().replace(/=(&|$)/g, '$1');
}

/**
 * Central permission check. Actions:
 *  order / send      build + send purchase orders          (floor, admin)
 *  receive           receive deliveries                    (floor, admin)
 *  boxes             open / remainder / sold out / close   (floor, admin)
 *  markPaid          mark invoices paid                    (accountant, admin)
 *  editCatalog       change existing game values & prices  (admin only)
 *  settings          settings screen                       (admin only)
 */
export function can(roleId, action) {
  if (roleId === 'admin') return true;
  if (roleId === 'accountant') return action === 'markPaid';
  if (roleId === 'floor') return ['order', 'send', 'receive', 'boxes'].includes(action);
  return false;
}
