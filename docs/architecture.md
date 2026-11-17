# System Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser: React 18 + Vite SPA (client/src)"]
    H[Home<br/>RA 10173 consent · ID + PIN]
    Q[Pre / Post / Retention quiz<br/>with 1-5 confidence]
    G[Classic round · Inbox mode · Daily challenge<br/>clues · link trap · QR · call transcripts]
    C[AI coach panel<br/>per-answer tip]
    HB[Case board<br/>badges · daily · class board · weak spots · certificate]
    V[/verify/:code<br/>public certificate check/]
    A[Educator dashboard<br/>scope picker · reports · Chapter 4 PDF · AI drafts · classes]
  end

  subgraph Vercel["Vercel (region sin1)"]
    CDN[(Static client/dist)]
    subgraph Fn["Serverless function api/index.js → Express createApp()"]
      R1[routes/players.js<br/>register · login · progress · badges · join class · leaderboards]
      R2[routes/game.js<br/>sessions · answers · link-click · coach · daily · finish]
      R3[routes/quiz.js · routes/surveys.js]
      R4[routes/admin.js<br/>accounts · settings · stats · exports · scenarios · AI · sections · reports]
      R5[routes/certificates.js<br/>issue · PDF · verify]
      LG[lib/game.js · adaptive.js · categories.js<br/>randomizer · scoring · weighting]
      LA[lib/ai.js<br/>AI SDK → AI Gateway, static fallback]
      LS[lib/stats.js · analytics.js · reports.js<br/>t-test · Wilcoxon · Welch · Mann-Whitney · PDFs]
      LB[lib/badges.js · daily.js · certificate.js]
      SC[lib/scope.js<br/>educator ↔ own sections]
      AU[lib/auth.js · ratelimit.js<br/>HMAC tokens · bcrypt · limits]
      REPO[db/repo.js<br/>one repository, two drivers]
    end
  end

  GW{{Vercel AI Gateway<br/>AI_GATEWAY_MODEL}}
  subgraph Data["Data"]
    PG[(Supabase Postgres<br/>supabase/migrations 0001-0006, RLS)]
    SQL[(SQLite<br/>local dev, migrate-sqlite.js)]
    SEED[data/scenarios.js + scenarios-ph2.js<br/>60 seed scenarios, SEED_VERSION]
    QP[data/quiz.js · data/surveys.js<br/>fixed study instruments]
  end

  H & Q & G & C & HB & V -->|fetch /api/* + player token| R1 & R2 & R3 & R5
  A -->|admin bearer token| R4
  R2 --> LG & LA & LB
  R4 --> LA & LS & SC
  R5 --> LB
  R1 & R2 & R3 & R4 & R5 --> AU
  R1 & R2 & R3 & R4 & R5 --> REPO
  LA -.only if credentials.-> GW
  REPO -->|DATABASE_URL set| PG
  REPO -->|otherwise| SQL
  SEED -->|insert-if-missing on boot| REPO
  R3 --> QP
```

## One classic round

```mermaid
sequenceDiagram
  participant P as Player (React)
  participant API as Express API
  participant DB as Postgres / SQLite
  participant AI as AI Gateway (optional)
  P->>API: POST /api/sessions {level, mode, language}
  API->>DB: unlocked level? weak categories (player_category_stats)
  API-->>P: sessionId, 8 sanitized scenarios, adaptive focus
  loop each message (timed)
    alt player opens a link / scans a QR
      P->>API: POST /sessions/:id/link-click
      API-->>P: phishing → "You got phished" (case lost) · legit → safe note
    end
    P->>API: POST /sessions/:id/answers {choice, timeMs, clickedParts}
    API->>DB: score, save answer, bump category stats
    API-->>P: verdict, points, red flags found/missed, explanation
    P->>API: POST /sessions/:id/coach
    API->>AI: personalised tip (weak spots) [if configured]
    API-->>P: AI tip, or the static category tip if AI is off/failing
  end
  P->>API: POST /sessions/:id/finish
  API->>DB: evaluate badges
  API-->>P: summary, unlocked level, new badges
```

## Design notes
- **Server-authoritative scoring.** Scenarios are sanitized (`publicScenario`) before they reach the browser; answers, red flags and scores are computed on the server.
- **Clickable clues.** The server splits each body into segments and isolates every red-flag snippet, so the client only returns part keys (`sender`, `seg:3`, `link:0`, `att:0`).
- **Adaptive selection.** Every answer updates `player_category_stats` (seen/missed per red-flag category). With at least 4 answers of evidence, rounds use an Efraimidis-Spirakis weighted shuffle that favours scenarios touching the player's weakest categories (weakness = (missed+1)/(seen+2)), while keeping the phishing/legit mix.
- **AI is optional and reviewed.** `lib/ai.js` uses the AI SDK (`generateText` + `Output.object` with a zod schema) through the Vercel AI Gateway. Generated scenarios are saved as `status='pending'`, `active=false` and are never served until an educator approves them (approval re-runs the same validator as manual scenarios). The coach falls back to static, category-specific tips; after a gateway failure it pauses AI calls for 5 minutes so players never wait on a broken provider.
- **Educator scoping.** `lib/scope.js` resolves which students an admin may see: superadmins see everyone (optionally one section); educators see only students in sections they own. Every list, stat, export, report and Chapter 4 PDF goes through `scopedData()`.
- **Research statistics in one place.** `lib/stats.js` implements paired t, Welch, Wilcoxon signed-rank and Mann-Whitney U (verified against reference values in tests). `lib/analytics.js` turns raw attempts into group comparisons, and `lib/reports.js` renders the Chapter 4 PDF with pdfkit.
- **Certificates.** Issued after the post-quiz, with an unguessable code `PD-XXXX-XXXX-XXXX` (crypto random, no ambiguous characters). `/api/verify/:code` and the `/verify/:code` page confirm it publicly; the PDF embeds a QR code to the verify page.
- **Additive migrations only.** `supabase/migrations/0001…0006` never drop data; `server/src/db/migrate-sqlite.js` mirrors each one for SQLite. `npm run test:pg` runs the whole suite against Postgres (PGlite) after applying every migration.
