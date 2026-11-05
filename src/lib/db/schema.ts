/** Bump when a table changes. The demo database is rebuilt and reseeded on a mismatch. */
export const SCHEMA_VERSION = 8;

export const TABLES = [
  "payout_items",
  "payout_batches",
  "flags",
  "shift_notes",
  "allocations",
  "tip_lines",
  "shifts",
  "nights",
  "staff",
  "restaurants",
];

export const SCHEMA = `
create table if not exists restaurants (
  id text primary key,
  name text not null,
  state text not null,
  takes_tip_credit integer not null,
  card_fee_rate real not null,
  points_per_hour text not null,
  service_open text,
  service_close text,
  policy_text text not null
);

create table if not exists staff (
  id text primary key,
  restaurant_id text not null references restaurants(id),
  name text not null,
  title text not null,
  role text not null,
  manager_duties integer not null,
  payout_wallet text not null check (payout_wallet in ('VENMO', 'PAYPAL')),
  payout_receiver text not null
);

create table if not exists nights (
  id text primary key,
  restaurant_id text not null references restaurants(id),
  date text not null,
  status text not null check (status in ('open', 'checked', 'paid')),
  unique (restaurant_id, date)
);

create table if not exists shifts (
  id integer primary key autoincrement,
  night_id text not null references nights(id),
  staff_id text not null references staff(id),
  station text not null,
  start text not null,
  end text not null,
  edited integer not null default 0
);

create table if not exists shift_notes (
  id integer primary key autoincrement,
  night_id text not null references nights(id),
  note text not null,
  applied text not null,
  rejected text not null,
  created_at text not null
);

create table if not exists tip_lines (
  id text primary key,
  night_id text not null references nights(id),
  source text not null check (source in ('paypal', 'venmo', 'card', 'cash')),
  table_label text not null,
  tip_cents integer not null check (tip_cents >= 0),
  auto_gratuity_cents integer not null default 0 check (auto_gratuity_cents >= 0),
  guest_could_change_auto integer not null default 0,
  paypal_order_id text
);

create table if not exists allocations (
  night_id text not null references nights(id),
  staff_id text not null references staff(id),
  minutes integer not null,
  points real not null,
  tip_cents integer not null,
  service_charge_cents integer not null,
  remainder_cents integer not null,
  primary key (night_id, staff_id)
);

create table if not exists flags (
  id integer primary key autoincrement,
  night_id text not null references nights(id),
  rule_id text not null,
  staff_id text,
  severity text not null,
  message text not null,
  resolved_at text
);

create table if not exists payout_batches (
  id text primary key,
  night_id text not null references nights(id),
  sender_batch_id text not null unique,
  paypal_batch_id text unique,
  status text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists payout_items (
  id text primary key,
  batch_id text not null references payout_batches(id),
  staff_id text not null references staff(id),
  wallet text not null,
  receiver text not null,
  amount_cents integer not null check (amount_cents > 0),
  paypal_item_id text unique,
  status text not null,
  error text,
  updated_at text not null
);
`;
