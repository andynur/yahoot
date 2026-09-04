-- 001 — full schema.
--
-- Consolidated from the original Postgres migration series: this is a fresh
-- SQLite database, so there is nothing to migrate forward from.
--
-- Durable data (accounts, quizzes, final results) and live game state live in
-- the same file but are kept in clearly separated table groups: everything
-- prefixed `live_` is session scratch and is deleted when a game ends.

create table teachers (
  id            text primary key,
  email         text not null unique,
  password_hash text not null,
  created_at    text not null
);

create table quizzes (
  id                         text primary key,
  teacher_id                 text not null references teachers (id) on delete cascade,
  title                      text not null,
  default_time_limit_seconds integer not null default 20
    check (default_time_limit_seconds between 5 and 120),
  default_max_points         integer not null default 1000
    check (default_max_points between 100 and 5000),
  theme                      text not null default '{"preset":"purple"}',
  created_at                 text not null,
  updated_at                 text not null
);
create index quizzes_teacher on quizzes (teacher_id, created_at desc);

create table questions (
  id                 text primary key,
  quiz_id            text not null references quizzes (id) on delete cascade,
  position           integer not null,
  kind               text not null default 'multiple_choice'
    check (kind in ('multiple_choice', 'true_false')),
  prompt             text not null,
  media              text not null default '{"kind":"none"}',
  choices            text not null,
  correct_index      integer not null,
  time_limit_seconds integer not null default 20,
  max_points         integer not null default 1000,
  unique (quiz_id, position)
);

create table game_sessions (
  id              text primary key,
  -- deleting a quiz takes its past sessions (and their results) with it
  quiz_id         text not null references quizzes (id) on delete cascade,
  host_teacher_id text not null references teachers (id) on delete cascade,
  pin             text not null,
  status          text not null default 'lobby',
  created_at      text not null,
  ended_at        text
);
-- A PIN is only unique among games that are still joinable.
create unique index game_sessions_active_pin
  on game_sessions (pin) where status <> 'ended';
create index game_sessions_host on game_sessions (host_teacher_id, created_at desc);

-- Written once, when the game ends. Never touched during play.
create table game_results (
  id            text primary key,
  session_id    text not null references game_sessions (id) on delete cascade,
  player_id     text not null,
  nickname      text not null,
  final_score   integer not null,
  final_rank    integer not null,
  correct_count integer not null,
  answers       text not null,
  unique (session_id, player_id)
);

-- --------------------------------------------------------------------------
-- Live game state. Replaces Redis; purged when a game ends.
-- --------------------------------------------------------------------------

create table live_games (
  pin        text primary key,
  snapshot   text not null,
  updated_at integer not null
);

create table live_players (
  pin       text not null,
  player_id text not null,
  nickname  text not null,
  avatar    text not null,
  joined_at integer not null,
  primary key (pin, player_id)
);

create table live_scores (
  pin           text not null,
  player_id     text not null,
  score         integer not null default 0,
  correct_count integer not null default 0,
  primary key (pin, player_id)
);

create table live_answers (
  pin            text not null,
  question_index integer not null,
  player_id      text not null,
  choice_index   integer not null,
  answered_at    integer not null,
  primary key (pin, question_index, player_id)
);

create table live_log (
  pin       text not null,
  player_id text not null,
  entries   text not null,
  primary key (pin, player_id)
);

create table live_prev_ranks (
  pin       text not null,
  player_id text not null,
  rank      integer not null,
  primary key (pin, player_id)
);

-- The atomic "this question has been scored" claim. A primary key collision is
-- what makes it exactly-once; see store.claimScoring.
create table live_scored (
  pin            text not null,
  question_index integer not null,
  primary key (pin, question_index)
);

create table live_active (
  pin text primary key
);
