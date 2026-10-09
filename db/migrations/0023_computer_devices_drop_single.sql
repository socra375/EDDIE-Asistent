-- EDDIE Prime: several computers per account, step 2 of 2 (see 0022). Apply it after the
-- code from the same release is deployed: the code before it relied on "one computer per
-- user" (on conflict (user_id)), the code after it on (user_id, name).
alter table computer_devices drop constraint if exists computer_devices_user_id_key;
