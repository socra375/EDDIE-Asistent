-- "Cuando encienda la PC", part 2 (see 0030). With Windows' "fast startup" a shutdown and start does NOT
-- change the system's boot time, so the agent also says whether it was off in between (it notes that it is
-- alive every ~20 s; a long silence before it starts means the computer was off). `start_fired_at` is the
-- last time such a start fired the routines: it keeps two hellos close together from firing twice.
alter table computer_devices add column if not exists start_fired_at timestamptz;
