-- Pictures Eddie FOUND (not created): where they came from. `source_url` is the
-- page of the picture on its source, `credit` the author and `license` the
-- licence as that source states it. All three stay null for pictures Eddie made.
-- Additive only: nothing existing changes.

alter table media_items add column if not exists source_url text;
alter table media_items add column if not exists credit text;
alter table media_items add column if not exists license text;
