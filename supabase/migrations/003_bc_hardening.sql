-- the audit function runs only as a trigger; nobody should call it through the API
revoke execute on function public.audit_row() from public, anon, authenticated;
-- foreign keys the app actually filters on
create index if not exists po_lines_po on po_lines (po_id);
create index if not exists shipments_po on shipments (po_id);
create index if not exists shipments_hall on shipments (hall_id, received_at desc);
create index if not exists products_vendor on products (vendor_id);
create index if not exists payments_hall on payments (hall_id);
create index if not exists box_counts_hall on box_counts (hall_id);
