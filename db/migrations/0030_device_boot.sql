-- "Cuando encienda la PC": the agent says when its computer was switched on (the
-- operating system's boot time) every time it starts. A boot time different from the one
-- kept here is a new start-up, and fires the routines of event "device_boot" — an agent that
-- only restarted (an update, a crash) reports the same boot time and fires nothing.
alter table computer_devices add column if not exists boot_at timestamptz;
