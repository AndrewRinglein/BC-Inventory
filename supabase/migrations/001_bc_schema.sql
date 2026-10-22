-- BC Inventory — baseline schema.
--
-- Consolidated from the bingo Inventory-Management schema as it stood after its
-- 54 migrations (commit e7dabdc), minus what BC does not use: two halls, product
-- types, deal/packing/split pricing, box locations, session sheets, per-hall hidden
-- games, and the bingo data fixes. Added for BC: form numbers and the spreadsheet's
-- game attributes, a closed_unsold box state, remainder counts (box_counts), and a
-- received date / optional PO on receipts.
--
-- Run once on an empty project (Supabase SQL editor, or `supabase db push`), then
-- 002_bc_seed.sql.

-- ---------------------------------------------------------------- reference data
create table halls (
  id   text primary key,              -- BC is one location: 'bc'. Kept so every query that
  name text not null                  -- filters by hall keeps working.
);

create table vendors (                -- distributors
  id           text primary key,      -- 'lib','tm','clk','lan'
  name         text not null,
  email        text not null default '',
  contact_name text,
  tax_rate     numeric(6,4) not null default 0,
  active       boolean not null default true
);

create table products (               -- games (one row per form number)
  id                   text primary key,            -- 'G001'... or 'C<timestamp>' when added in the app
  vendor_id            text not null references vendors(id),
  name                 text not null,
  orig_name            text,
  form_number          text not null,
  vendor_sku           text,                        -- alternate code a distributor prints, if any
  aliases              text[] not null default '{}',
  cost                 numeric(10,2) not null default 0 check (cost >= 0),   -- per box; 0 = not known yet
  tickets              integer check (tickets is null or tickets >= 0),     -- = ideal gross receipts at $1/ticket
  price_per_ticket     numeric(6,2) not null default 1,
  ideal_gross_receipts numeric(10,2),
  ideal_cash_prize     numeric(10,2),
  ideal_profit         numeric(10,2),
  non_cash_prize_value numeric(10,2),
  net_profit           numeric(10,2),
  progressive_amount   numeric(10,2),
  progressive_note     text,                        -- e.g. "Red: 200, White: 100, Blue: 50"
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);
create unique index products_form_number on products (upper(btrim(form_number)));

-- A rename keeps the previous name as an alias, in the database, so it holds for the
-- app, direct SQL and migrations alike.
create or replace function keep_old_product_name() returns trigger language plpgsql as $$
declare old_name text := btrim(coalesce(old.name, ''));
begin
  if old_name <> '' and btrim(coalesce(new.name, '')) <> old_name then
    if not exists (select 1 from unnest(coalesce(new.aliases, '{}'::text[])) a
                    where lower(btrim(a)) = lower(old_name)) then
      new.aliases := coalesce(new.aliases, '{}'::text[]) || old_name;
    end if;
  end if;
  return new;
end $$;
create trigger products_keep_old_name before update of name on products
  for each row execute function keep_old_product_name();

-- ---------------------------------------------------------------- purchasing
create table order_qty (              -- order-builder quantities, persisted
  hall_id    text not null references halls(id),
  product_id text not null references products(id),
  qty        integer not null default 0 check (qty >= 0),
  primary key (hall_id, product_id)
);

create table purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  num             text not null unique,              -- e.g. BC-26-10-22-LIB-001
  hall_id         text not null references halls(id),
  vendor_id       text not null references vendors(id),
  status          text not null default 'draft' check (status in ('draft','sent','partial','closed')),
  subtotal        numeric(12,2) not null default 0,
  tax             numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  price_tbd_lines integer not null default 0,        -- lines that went out as "?"
  recorded_only   boolean not null default false,    -- placed outside the app, no email sent
  vendor_ref      text,
  sent_at         timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table po_lines (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  product_id    text references products(id),
  kind          text not null default 'item' check (kind in ('item','fee')),
  name_snapshot text not null,                       -- name + form + tickets at send time
  qty           integer not null check (qty > 0),
  cost          numeric(10,2) not null default 0,    -- locked per-box cost at send time
  price_tbd     boolean not null default false,
  -- Kept so the shared PO email / reprint / reprice code reads the same shape it was
  -- written for. BC always writes 1 / 0 here.
  base_cost     numeric(10,2),
  pack_units    integer,
  packing_each  numeric(10,2) not null default 0,
  split_boxes   integer,
  taxable       boolean not null default true
);

create table shipments (              -- one per Receive session (a delivery)
  id                  uuid primary key default gen_random_uuid(),
  hall_id             text not null references halls(id),
  po_id               uuid references purchase_orders(id),   -- optional: BC can receive without a PO
  invoice_no          text not null default '',
  received_on         date not null default current_date,    -- the date on the Receive screen
  invoice_photo_path  text,
  invoice_photo_paths text[] not null default '{}',
  notes               text not null default '',
  received_at         timestamptz not null default now(),
  confirmed           boolean not null default false
);

-- ---------------------------------------------------------------- adjustments
create table stock_adjustments (
  id         uuid primary key default gen_random_uuid(),
  hall_id    text not null,
  at         timestamptz not null default now(),
  reason     text not null check (reason in ('swap','damaged','miscount','found','returned')),
  note       text not null,
  actor      text not null default 'app',
  created_at timestamptz not null default now()
);
create table stock_adjustment_lines (
  id            uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references stock_adjustments(id) on delete cascade,
  hall_id       text not null,
  product_id    text not null references products(id),
  delta         integer not null check (delta <> 0),
  each_value    numeric(10,2) not null default 0
);
create index sa_hall_at on stock_adjustments (hall_id, at desc);
create index sal_adj on stock_adjustment_lines (adjustment_id);

-- ---------------------------------------------------------------- boxes
create table boxes (
  id                uuid primary key default gen_random_uuid(),
  hall_id           text not null references halls(id),
  product_id        text not null references products(id),
  po_id             uuid references purchase_orders(id),
  shipment_id       uuid references shipments(id),
  adjustment_id     uuid references stock_adjustments(id),
  source            text not null default 'receive' check (source in ('po','receive','adjust')),
                                    -- po = placeholder created when the PO was sent
  serial            text not null default '',
  cost              numeric(10,2) not null default 0,
  price_tbd         boolean not null default false,
  state             text not null default 'on_order'
    check (state in ('on_order','in_inventory','opened','sold_out','closed_unsold','missing')),
  game_snapshot     jsonb,          -- game attributes at receive time, for the compliance report
  tickets_remaining integer,        -- latest remainder count (history in box_counts)
  ordered_at        timestamptz default now(),
  received_on       date,           -- the date picked on Receive
  received_at       timestamptz,
  opened_on         date,           -- the session date picked on Open
  opened_at         timestamptz,    -- exact time of the open scan
  sold_out_at       timestamptz,
  closed_at         timestamptz     -- closed unsold
);
create index boxes_hall_state on boxes (hall_id, state);
create index boxes_po on boxes (po_id);
create index boxes_shipment on boxes (shipment_id);
create index boxes_sold_out_at on boxes (sold_out_at) where sold_out_at is not null;
create index boxes_closed_at on boxes (closed_at) where closed_at is not null;
-- one box per game + serial (placeholders have no serial yet)
create unique index boxes_game_serial on boxes (product_id, serial) where serial <> '';

-- state machine guard: forbid illegal transitions and stamp the time server-side
create or replace function guard_box_state() returns trigger as $$
begin
  if old.state = new.state then return new; end if;
  if not (
    (old.state = 'on_order'      and new.state in ('in_inventory','missing')) or
    (old.state = 'in_inventory'  and new.state in ('opened','missing','on_order')) or  -- on_order = undo receive
    (old.state = 'opened'        and new.state in ('sold_out','closed_unsold','in_inventory')) or  -- in_inventory = undo open
    (old.state = 'sold_out'      and new.state in ('opened')) or         -- undo only
    (old.state = 'closed_unsold' and new.state in ('opened')) or         -- undo only
    (old.state = 'missing'       and new.state in ('in_inventory','on_order'))
  ) then
    raise exception 'illegal box state transition: % -> %', old.state, new.state;
  end if;
  if new.state = 'in_inventory'  and new.received_at is null then new.received_at := now(); end if;
  if new.state = 'opened'        and new.opened_at   is null then new.opened_at   := now(); end if;
  if new.state = 'sold_out'      and new.sold_out_at is null then new.sold_out_at := now(); end if;
  if new.state = 'closed_unsold' and new.closed_at   is null then new.closed_at   := now(); end if;
  return new;
end $$ language plpgsql;
create trigger boxes_state_guard before update on boxes
  for each row execute function guard_box_state();

-- every remainder count, and the count at close-unsold. Never edited, only added.
create table box_counts (
  id           uuid primary key default gen_random_uuid(),
  box_id       uuid not null references boxes(id) on delete cascade,
  hall_id      text not null references halls(id),
  tickets_left integer not null check (tickets_left >= 0),
  kind         text not null default 'remainder' check (kind in ('remainder','close')),
  session_date date not null default current_date,
  counted_at   timestamptz not null default now()
);
create index box_counts_box on box_counts (box_id, counted_at desc);

-- ---------------------------------------------------------------- money + mail
create table payments (
  id         uuid primary key default gen_random_uuid(),
  hall_id    text not null references halls(id),
  vendor_id  text not null references vendors(id),
  po_num     text not null,
  invoice_no text not null default '',
  amount     numeric(12,2) not null,
  status     text not null default 'open' check (status in ('open','paid')),
  created_at timestamptz not null default now()
);

create table emails (
  id          uuid primary key default gen_random_uuid(),
  hall_id     text references halls(id),
  po_num      text,
  kind        text not null check (kind in ('po','po_copy','shortage','delivered','settlement','price_request','export','other')),
  to_addr     text not null,
  subject     text not null,
  body        text not null,
  test_mode   boolean not null default true,
  provider_id text,
  status      text not null default 'queued' check (status in ('queued','sent','failed')),
  created_at  timestamptz not null default now()
);

create table events (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     text not null default 'app',
  kind      text not null,
  entity    text not null,
  entity_id text not null,
  detail    jsonb not null default '{}'::jsonb
);
create index events_at on events (at desc);

create table settings (
  key   text primary key,
  value jsonb not null
);

-- ---------------------------------------------------------------- views
create view adjustment_history with (security_invoker = on) as
select a.id, a.at, a.hall_id as booked_hall, a.reason, a.note, a.actor,
       l.hall_id, l.product_id, p.name as game, v.name as distributor,
       l.delta, l.each_value, round(l.delta * l.each_value, 2) as value_change
  from stock_adjustments a
  join stock_adjustment_lines l on l.adjustment_id = a.id
  left join products p on p.id = l.product_id
  left join vendors  v on v.id = p.vendor_id;

-- ---------------------------------------------------------------- audit + security
create or replace function audit_row() returns trigger as $$
declare eid text;
begin
  eid := coalesce(case when tg_op = 'DELETE' then null else (to_jsonb(new)->>'id') end,
                  (to_jsonb(old)->>'id'), '?');
  insert into events (actor, kind, entity, entity_id, detail)
  values (
    coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'app'),
    lower(tg_op), tg_table_name, eid,
    case when tg_op = 'DELETE' then jsonb_build_object('old', to_jsonb(old))
         when tg_op = 'INSERT' then jsonb_build_object('new', to_jsonb(new))
         else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$ language plpgsql security definer set search_path = public;

create trigger audit_boxes      after insert or update or delete on boxes           for each row execute function audit_row();
create trigger audit_box_counts after insert or update or delete on box_counts      for each row execute function audit_row();
create trigger audit_pos        after insert or update or delete on purchase_orders for each row execute function audit_row();
create trigger audit_products   after insert or update or delete on products        for each row execute function audit_row();
create trigger audit_payments   after insert or update or delete on payments        for each row execute function audit_row();

-- RLS: everything requires a signed-in user
do $$
declare t text;
begin
  foreach t in array array['halls','vendors','products','order_qty','purchase_orders','po_lines',
                           'shipments','boxes','box_counts','payments','emails','settings',
                           'stock_adjustments','stock_adjustment_lines']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_auth_all on %I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- events: readable by signed-in users; the app may add labelled activity rows, and
-- only of the kinds it actually writes. Row-level audit rows come from the trigger.
alter table events enable row level security;
create policy events_auth_read on events for select to authenticated using (true);
create policy events_auth_insert on events for insert to authenticated
  with check (
    kind in ('eom', 'adjust', 'count', 'price_request')
    or kind ~ '^(po|box|shipment|stock|email|catalog)\.[a-z_]+$'
  );
