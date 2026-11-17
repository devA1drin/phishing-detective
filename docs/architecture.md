# System Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (React + Vite SPA)"]
    H[Home / Register<br/>nickname or student ID]
    Q[Pre / Post Quiz]
    G[Game Round<br/>timer · clue clicking · feedback]
    S[Round Summary<br/>& Case Board]
    A[Admin Dashboard<br/>analytics · CSV · scenario CRUD]
  end

  subgraph Server["Node.js + Express API (server/src)"]
    R1[routes/players.js<br/>register · progress · leaderboard]
    R2[routes/game.js<br/>sessions · answers · finish]
    R3[routes/quiz.js<br/>pre/post pools · grading]
    R4[routes/admin.js<br/>login · stats · export · CRUD]
    L[lib/game.js<br/>randomizer · segmenter · scoring · unlocks]
    AU[lib/auth.js<br/>HMAC admin token]
    REPO[db/index.js<br/>repository factory]
  end

  subgraph Data["Data layer"]
    SQL[(SQLite<br/>better-sqlite3)]
    PG[(Supabase / Postgres<br/>future driver)]
    SEED[data/scenarios.js<br/>42 seed scenarios]
    QP[data/quiz.js<br/>pre & post pools]
  end

  H & Q & G & S -->|fetch /api/*| R1 & R2 & R3
  A -->|Bearer token| R4
  R2 --> L
  R4 --> AU
  R1 & R2 & R3 & R4 --> REPO
  REPO --> SQL
  REPO -.swap via DB_DRIVER.-> PG
  SEED -->|auto-seed on first run| SQL
  R3 --> QP
```

## Request flow for one game round

```mermaid
sequenceDiagram
  participant P as Player (React)
  participant API as Express API
  participant DB as SQLite
  P->>API: POST /api/sessions {playerId, level}
  API->>DB: check unlocked level, pick 8 random scenarios
  API-->>P: sessionId + scenarios (no answers, body split into clickable segments)
  loop each message (timed)
    P->>API: POST /api/sessions/:id/answers {scenarioId, choice, timeMs, clickedParts}
    API->>DB: score (base + time bonus × streak + clue bonus), save answer
    API-->>P: correct?, points breakdown, red flags (found/missed), explanation
  end
  P->>API: POST /api/sessions/:id/finish
  API-->>P: summary + newly unlocked level
```

Design notes
- **Answers never reach the client before the player commits.** Scenarios are sanitized (`publicScenario`) and scored server-side, so the game cannot be cheated from DevTools.
- **Clickable clues:** the server splits each message body into sentence segments and isolates each red-flag snippet as its own segment. The client returns the part keys the player clicked (`sender`, `subject`, `seg:3`, `link:0`, `att:0`) and the server matches them against the red flags.
- **Swappable data layer:** routes only call async repository methods (`findOrCreatePlayer`, `createSession`, `recordAnswer`, `overview`, …). A Postgres/Supabase repository with the same method names can replace `db/sqlite.js`; see `supabase-migration.md`.
