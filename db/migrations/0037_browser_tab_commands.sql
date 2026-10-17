-- Orders for the user's browser besides «open this page»: close, reload, move, pin or mute tabs («kind = tabs», the steps
-- in `payload`), and how long an order stays valid when the browser is closed (`ttl_seconds`, default 2 minutes).
alter table browser_commands add column if not exists kind text not null default 'open';
alter table browser_commands add column if not exists payload jsonb;
alter table browser_commands add column if not exists ttl_seconds integer;
