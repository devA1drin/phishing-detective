# Entity Relationship Diagram

```mermaid
erDiagram
  ADMINS ||--o{ SECTIONS : owns
  ADMINS ||--o{ SCENARIOS : "creates / reviews"
  SECTIONS ||--o{ PLAYERS : "has members"
  PLAYERS ||--o{ GAME_SESSIONS : plays
  PLAYERS ||--o{ QUIZ_ATTEMPTS : takes
  PLAYERS ||--o{ SURVEYS : answers
  PLAYERS ||--o{ PLAYER_CATEGORY_STATS : "weakness per category"
  PLAYERS ||--o{ PLAYER_BADGES : earns
  PLAYERS ||--o| CERTIFICATES : "is issued"
  GAME_SESSIONS ||--o{ ANSWERS : contains
  SCENARIOS ||--o{ ANSWERS : "answered in"

  PLAYERS {
    bigint id PK
    text nickname UK "nickname or student ID (no real personal data)"
    text pin_hash "bcrypt, 4-6 digit PIN"
    text group_name "experimental | control"
    text group_source "random | admin | legacy"
    timestamptz consent_at "RA 10173 consent"
    text consent_version
    timestamptz reading_done_at "control-group task"
    bigint section_id FK "nullable"
    timestamptz created_at
  }
  SECTIONS {
    bigint id PK
    text name
    text join_code UK "6 chars, shared by the educator"
    bigint owner_admin_id FK
    timestamptz created_at
  }
  ADMINS {
    bigint id PK
    text username UK
    text password_hash "bcrypt"
    text role "superadmin | educator"
    text display_name
    timestamptz last_login_at
  }
  SCENARIOS {
    text id PK
    text channel "email | sms | social | call"
    text language "en | tl | taglish"
    smallint difficulty "1-3"
    bool is_phishing
    text sender_name
    text sender_address
    text subject
    text body "{{link:N}} placeholders; call = Caller:/You: lines"
    jsonb links "[{text, href, qr?}]"
    jsonb attachments
    jsonb red_flags "[{target, match, index, label, detail}]"
    jsonb safe_signs
    text explanation
    bool active
    text status "approved | pending | rejected"
    text source "seed | admin | ai"
    text ai_model
    bigint created_by FK
    bigint reviewed_by FK
    timestamptz reviewed_at
  }
  GAME_SESSIONS {
    bigint id PK
    bigint player_id FK
    smallint level
    text mode "classic | inbox | daily"
    text language "all | en | fil"
    text challenge_date "YYYY-MM-DD (Manila) for daily; unique per player"
    jsonb scenario_ids
    int score
    int correct
    int answered
    int max_streak
    timestamptz started_at
    timestamptz finished_at
  }
  ANSWERS {
    bigint id PK
    bigint session_id FK
    text scenario_id FK
    text choice "phishing | legit | null (timeout)"
    bool is_correct
    bool link_clicked "link trap"
    int time_ms
    int flags_found
    int false_clicks
    int points
  }
  QUIZ_ATTEMPTS {
    bigint id PK
    bigint player_id FK
    text kind "pre | post | retention"
    int score
    int total
    jsonb answers "[{itemId, choice, confidence 1-5, correct}]"
  }
  SURVEYS {
    bigint id PK
    bigint player_id FK
    text kind "sus | iso25010"
    jsonb answers
    numeric score
  }
  PLAYER_CATEGORY_STATS {
    bigint player_id PK
    text category PK "sender | link | urgency | credentials | money | attachment | pretext | legit"
    int seen
    int missed
  }
  PLAYER_BADGES {
    bigint player_id PK
    text badge_id PK
    timestamptz earned_at
  }
  CERTIFICATES {
    text code PK "PD-XXXX-XXXX-XXXX"
    bigint player_id FK "unique"
    text nickname
    numeric pre_percent
    numeric post_percent
    numeric retention_percent
    int rounds
    numeric accuracy
    int badges
    timestamptz issued_at
  }
  SETTINGS {
    text key PK "controlRatio | retentionDays | minRoundsForPost | seedVersion"
    jsonb value
  }
```

Notes
- Quiz items, survey items and badge definitions are versioned in code (`server/src/data/quiz.js`, `data/surveys.js`, `lib/badges.js`) so the study instruments stay fixed; only responses are stored.
- Deleting a player cascades to sessions, answers, quiz attempts, surveys, category stats, badges and the certificate (data-subject erasure). Deleting a section only clears `players.section_id`. Deleting an admin sets `owner_admin_id`, `created_by` and `reviewed_by` to null.
- All tables have RLS enabled with access revoked from Supabase's public `anon`/`authenticated` roles; only the server's `pd_app` role can read and write.
