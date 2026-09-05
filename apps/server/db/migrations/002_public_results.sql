-- Public, shareable result pages.
--
-- The token stays null until the teacher explicitly asks to share: a result row
-- carries every student's nickname and score, so nothing becomes reachable
-- without an act by the person who ran the game. Revoking sets it back to null,
-- which kills the old link immediately.
--
-- Partial unique index, not a plain one: SQLite treats each NULL as distinct in
-- a unique index, but being explicit documents that only real tokens collide.
alter table game_sessions add column share_token text;
create unique index game_sessions_share_token
  on game_sessions (share_token) where share_token is not null;

-- The podium draws each player's avatar, but until now only the live tables
-- held it — so a result page rebuilt after the game had nothing to show. Empty
-- string for rows written before this migration; the API substitutes a default.
alter table game_results add column avatar text not null default '';
