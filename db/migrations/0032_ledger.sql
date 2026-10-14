-- Cuentas del negocio: the books Eddie keeps for the user as administrator/accountant —
-- income and expenses, and what is still owed to or by the business (`status =
-- 'pendiente'`, with an optional due date). Money is stored in cents (bigint) so sums
-- never drift. `currency` is whatever the user says (DOP, USD…), empty if never said.
-- `paid_date` is set when a pending entry is settled; reports count an entry on
-- coalesce(paid_date, entry_date). Same access model as 0001: only our backend touches
-- this table and every query filters by the user.

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('ingreso', 'gasto')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default '',
  concept text not null,
  category text not null default '',
  client text not null default '',
  entry_date date not null,
  status text not null default 'pagado' check (status in ('pagado', 'pendiente')),
  due_date date,
  paid_date date,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ledger_user_date_idx on ledger_entries(user_id, entry_date desc);
create index if not exists ledger_user_pending_idx on ledger_entries(user_id, due_date) where status = 'pendiente';
