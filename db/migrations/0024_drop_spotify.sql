-- Spotify was removed: the connector and its OAuth flow are gone from the
-- code, so the table that stored each user's tokens (0007_spotify.sql) is
-- no longer read or written by anything.
drop table if exists spotify_credentials;
