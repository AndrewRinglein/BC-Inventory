// Store selector: real Supabase when configured, otherwise browser-local demo mode.
//
// Both stores expose the SAME interface, so every screen is written once:
//   init(), isDemo
//   auth:      signIn(email, pass), signOut(), getSession()
//   catalog:   getVendors(), addVendor(v), updateVendor(id, f), getProducts(), updateProduct(id, f), addProduct(p)
//   orderQty:  getOrderQty(hallId), setOrderQty(hallId, productId, qty), clearOrderQty(hallId)
//   pos:       createSentPos(hallId, drafts, numbered, opts), getPos(hallId), getPoLines(poId),
//              getPoLinesFor(ids), setPoStatus, repricePo, setPoArchived, deletePo
//   boxes:     getBoxes(hallId), updateBox(id, f), transitionBox(id, to), createBoxes(list)
//   BC floor:  receiveBox({...}), undoReceiveBox(id), openBox(id, {openedOn}), undoOpen(id),
//              recordRemainder(id, n, {sessionDate}), undoRemainder(countId), soldOut(id),
//              closeUnsold(id, n, {sessionDate}), reopenBox(id), getBoxCounts(hallId)
//   receiving: createShipment(s), confirmShipment(id, summary), getShipments(hallId),
//              getArrivals(hallId), getReceiptDetail(id), uploadInvoicePhoto(file)
//   stock:     adjustStock({...}), addAdjustment({...}), getAdjustments(hallId)
//   payments:  getPayments(hallId), addPayment(p), setPaymentStatus(id, status)
//   emails:    sendEmails(list, hallId) (edge function in prod, log-only in demo), getEmails(hallId)
//   settings:  getSetting(key), setSetting(key, value)
//   events:    getEvents(limit), logEvent(kind, entity, id, detail)
//   ai:        readInvoicePhoto(path) -> extracted lines (edge fn / demo stub)

import { DemoStore } from './demoStore.js';
import { SupabaseStore } from './supabaseStore.js';
import { demoFromUrl } from '../roles.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ?demo in the URL always opens the staged sandbox, even when Supabase is configured.
// Without Supabase keys, the app runs on the (empty-start) local store.
const wantDemo = demoFromUrl();
export const store = wantDemo || !(url && key)
  ? new DemoStore(wantDemo)          // true -> staged sandbox with rich fake data
  : new SupabaseStore(url, key);
export const IS_DEMO = store.isDemo;
export const IS_SANDBOX = wantDemo;
