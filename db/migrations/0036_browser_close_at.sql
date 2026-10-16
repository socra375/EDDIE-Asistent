-- Pages Eddie opens only for a moment (the morning good-morning opens Gmail and the calendar while it speaks): the moment
-- the extension should close them again. Nothing for the pages that stay (a document he made, a meeting).
alter table browser_commands add column if not exists close_at timestamptz;
