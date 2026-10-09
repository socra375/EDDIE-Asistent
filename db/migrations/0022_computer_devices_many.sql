-- EDDIE Prime: several computers per account (the Windows PC and the Chromebook, say).
-- Step 1 of 2 and purely additive, so the code that is running while this is applied keeps
-- working: a computer is now identified by (user, name) — linking the same computer again
-- replaces it, a different one is added — and it says what kind of system it is.
-- Step 2 (0023_computer_devices_drop_single.sql) drops the old "one per user" rule once the
-- code that expects several is live.
alter table computer_devices add column if not exists platform text;
create unique index if not exists computer_devices_user_name_idx on computer_devices(user_id, name);
