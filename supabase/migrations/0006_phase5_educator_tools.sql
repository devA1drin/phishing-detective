-- Phase 5: educator tools (additive). Educators see only students in sections they own;
-- lookups by owner and by section are indexed.
create index if not exists idx_sections_owner on sections(owner_admin_id);
create index if not exists idx_game_sessions_player on game_sessions(player_id);
create index if not exists idx_quiz_attempts_player on quiz_attempts(player_id);
