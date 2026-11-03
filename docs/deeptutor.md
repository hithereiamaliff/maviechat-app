# DeepTutor: findings and integration notes (M1.5)

Checked on 2026-11-01 against **HKUDS/DeepTutor v1.7.1** (commit `f7aed07`, released that day). The plan is in `docs/plan.md` under "M1.5 DeepTutor".

DeepTutor is a **spec only**, like Open WebUI and Conduit (see `AGENTS.md`). Read it for facts such as paths, fields and behaviour, then write our own code. Paths below are as its own web UI calls them; the M1.5 spike confirms them against the deployed version.

## What it is

- **An AI learning workspace, not just chat.** It has Chat, Quiz, Research, Visualize, Solve, Mastery Path, Reading, Books, Practice, Task Board, Calendar, Notebooks, Memory (an L1–L3 graph), Partners, Co-Writer, personas, skills and MCP.
- **Stack:**
  - A Python core (FastAPI) and a Next.js web UI (`web/`: 63 pages, about 270k lines of its own TypeScript).
  - Its desktop app is Electron around the same web UI. Mobile clients "will live in their own folders as remote clients"; none exist yet.
  - Docker Compose files ship in the repo (`docker-compose.yml`, `docker-compose.ghcr.yml`).
- **Licence:** Apache-2.0.
- **Pace:** 14 releases from 3 September to 1 November 2026 (v1.6.4 → v1.7.1), about one every four days.
- **No OpenAI-compatible endpoint**, so Open WebUI can't simply list DeepTutor as a model connection.

## Sign-in

- **Off by default.** It runs single-user with no login, so anyone who reaches it gets the admin workspace. Never expose that publicly.
- **Multi-user mode:**
  - Turn it on in `data/user/settings/auth.json` and restart.
  - The first account registered at `/register` becomes admin.
  - Admins add users at `/admin/users` and grant models, knowledge bases, skills, tools and code execution.
  - Each user gets an isolated workspace under `data/users/<uid>/`.
- **Password sign-in:** `POST /api/auth/login {username, password}`.
  - It sets an HttpOnly cookie, `dt_token` (a JWT).
  - The body is `{ok, user_id, username, role, is_admin, must_change_password}`; the token itself is not in it.
- **The API also accepts `Authorization: Bearer <token>`.** How the app gets and keeps the token (the native cookie store or the `Set-Cookie` header) is the first question for the M1.5 spike.
- Other routes: `GET /api/auth/status`, `POST /api/auth/logout`, `GET /api/auth/profile`.
- **Device credentials** work with built-in sign-in only:
  - An admin issues a pairing code and PIN for an ordinary account (`POST /api/auth/devices`).
  - `POST /api/auth/device-login {pairing_code, pin}` sets the same cookie.
  - They are revocable and can expire or carry daily limits.
- **Private sign-in hosts** (`auth.private_login_hosts`): when set, password sign-in works only from those front-end hosts, and public origins use a short-lived handoff. Leave it empty for the app, or use device credentials.
- **Keep the backend private:**
  - It trusts front-end host assertions only from loopback by default (`AUTH_TRUSTED_FRONTEND_PROXY_IPS` widens that).
  - Keep the backend behind its own web front end, preserve `Host` through nginx, and never publish a raw Next.js port.

## Chat

- **Sessions** are REST under `/api/sessions`:
  - list, `/search`, get (`/{id}`) and rename (PATCH);
  - delete (to a recycle bin), restore and purge;
  - threads, branch selection (`PUT /{id}/branch-selection`) and delete turn (`DELETE /{id}/messages/{message_id}`).
- **Turns run over a WebSocket at `/ws`**, turn protocol **2.0**:
  - Commands carry `protocol_version: "2.0"` and are acknowledged with `command_ack`.
  - Besides starting a turn: `subscribe_session`, `resume_from` (a sequence number, so streams can be replayed), `check_active_turn`, `cancel_turn`, `regenerate`, `submit_user_reply`, `user_input`, `ping`.
- **A turn request** has:
  - `content`, `capability` (default `chat`), `session_id`, `parent_message_id`, `regenerate`;
  - `tools`, `knowledge_bases`, `skills`, `mcp`, `persona`, `llm_selection`;
  - `attachments` (`{type, url, filename, mime_type, id}`);
  - references: `history_references` (other sessions), `notebook_references`, and book, reading and memory references.

## Moving material between the apps

- **Notebooks** are REST under `/api/notebooks`:
  - list, create, get, update, delete, and export as plain text;
  - `POST /api/notebooks/actions/add-record` takes `{notebook_ids, record_type, title, summary?, user_query, output, metadata, kb_name?}`, where `record_type` includes `chat`.
  - Any turn can reference a notebook (`notebook_references`).
- **Knowledge bases** are REST under `/api/knowledge-bases`: create, `POST /{kb}/upload`, and indexing progress (also over a WebSocket).
- **Chat-history import** (`POST /api/imports/chat-history`) accepts only `chatgpt`, `claude_code` and `codex` sources, so Open WebUI chats go in as notebook records instead.

## How M1.5 uses it

| Direction | How |
|---|---|
| DeepTutor → Open WebUI | Pick a session (`GET /api/sessions`, `/search`), fetch it (`GET /api/sessions/{id}`) and render its shown branch as Markdown. It is attached as a `text` item that travels with the message: Open WebUI reads such items' `content` directly, as the web does for attached web pages, so nothing is uploaded. Chats over 60,000 characters keep their newest part. It shows as a file chip on your message. |
| Open WebUI → DeepTutor | Render the shown branch as Markdown and add it to the "From MavieChat" notebook (`POST /api/notebooks`, `POST /api/notebooks/actions/add-record`, `record_type: "chat"`). Reference that notebook in any DeepTutor chat. |
| Everything else | DeepTutor's own web UI in a web view, signed in. |

## Spike results (1.7.1, `npm run probe:deeptutor` ✓)

- **Native sign-in works with a Bearer token.**
  - `POST /api/auth/login` answers `{ok, user_id, username, role, is_admin, must_change_password}`; the token travels only in `Set-Cookie: dt_token=…; HttpOnly; Max-Age=2592000; Path=/; SameSite=None; Secure`.
  - `/api/*` through the front end accepts `Authorization: Bearer <token>` or the cookie. Without either: 401.
  - `GET /api/auth/status` works signed out too (`authenticated: false`), so the app can check a stored sign-in.
- **Web pages want the cookie.** `/chat` with only a Bearer header redirects to `/login?next=%2Fchat` (a relative redirect, so the proxy setup is fine); with the cookie it answers 200.
  - Plan for the web view: native sign-in leaves `dt_token` in iOS's shared cookie store, which `react-native-webview` can share (`sharedCookiesEnabled`).
  - Fallback if that fails on the phone: open `/login` (outside the sign-in gate), set a `dt_token` cookie from the stored token, then go to `/chat`.
  - DeepTutor's session hand-off isn't usable: it needs private sign-in hosts, which would block password sign-in from the app.
- **Signing out only clears the cookie.** Tokens are stateless, so a copied token keeps working until it expires. The app must forget its copy.
- **Notebook records:** always send a `summary`. An empty one makes the server ask its own model for one, which costs tokens and fails while no model is set.
- **Version:** `GET /api/system/update` (signed in) → `current_version`.
- **Sessions** list as `{sessions}`, search as `{sessions, total, limit, offset}`, and a session comes with all its messages. The shown branch follows `preferences.selected_branches` (`{parent message id: chosen reply id}`), else the newest reply.
- Not yet checked: a real session's messages, since the test account has none until a model is configured.

## Native chat (slice 1, 2026-11-01)

Each DeepTutor chat is a native screen (since 2026-11-03 the space opens on a new chat, with your chats in the sidebar; see "The DeepTutor space"). In DeepTutor's **Chat** mode:
- streaming replies with their reasoning (folded), each tool call where it happened (with its result), and sources;
- stop, regenerate, copy;
- the model (from the account's granted models) and the switchable tools, per chat;
- a reply resumes after a dropped connection or a trip to the background, and a reply started on another device shows as it streams.

Chats in modes the app doesn't run natively open read-only with **Open in DeepTutor Web App** (slice 2 made Solve, Quiz, Research, Visualize and Ask Questions native). DeepTutor's other pages are in the sidebar.

**Code:** `packages/deeptutor-protocol` (`turns.ts`, `turnConnection.ts`, `turnReply.ts`, `chatOptions.ts`); the app's `features/deeptutor/chat/` and `app/(deeptutor)/learn/`.

### Protocol facts (1.7.1, checked with `npm run probe:deeptutor -- --turn`)

- **Signing in on the socket:** `/ws` takes the `dt_token` cookie or `?token=`. Don't use `?token=`: DeepTutor's log records socket query strings. A refused sign-in fails the handshake (uvicorn answers 403; DeepTutor's own close code is 4001).
  - **iOS quirk (found on the phone, 2026-11-01):** React Native's iOS WebSocket first adds the cookies iOS holds for the site (the `dt_token` saved at sign-in) and then *appends* a `Cookie` header given in its options after a comma. A plain `dt_token=…` header therefore arrived as `dt_token=A,dt_token=B`, one unreadable value, and every socket got 403.
  - The fix, `socketCookieHeader()`, sends `maviechat=1; dt_token=…`. Our `dt_token` then sits in a pair of its own at the end, and DeepTutor (Starlette) keeps the last value of a repeated cookie. Checked locally and through the public address with a stored cookie, none, and a stale one.
  - Node 22's built-in WebSocket takes `{headers}`; the probe sends the same header.
- **A Chat-mode turn**, in order:
  1. `session` (seq 1, names the session and turn);
  2. `stage_start` (`responding`);
  3. per round of the agent loop: `progress` ("Exploring"), `thinking` chunks, `content` chunks;
  4. for each tool: `tool_call` (with `assistant_content_offset`, the answer length when it was called), then `tool_result`;
  5. `stage_end`, `sources`, `result` (`response` = the last round's text), then `done` (`status`, `user_message_id`, `assistant_message_id`, usage).
- **The answer** is every `content` chunk whose call is an agent-loop round or a final response (or has no call id), the remarks before tool calls included. The saved message's text equals it exactly (the probe checks this after a deliberate drop).
- **A saved reply** keeps its `tool_call`, `tool_result`, `result` and `done` events, but not its reasoning. The full events come from `GET /api/sessions/{id}/messages/{message_id}/events`.
- **A running session:** `status: "running"`, `active_turn_id`, and `active_turns` (`[{id, status, last_seq}]`). The reply is saved only at `done`.
- **After `done`, the session refuses new turns for about 8 seconds:** "Session already has an active or recovering turn" (`start_turn_rejected`, `regenerate_rejected`) while DeepTutor holds the turn's lease. Nothing is created before a turn is accepted, so the app sends the same command again every 2 s, for up to 30 s, and shows "Waiting for DeepTutor to finish the last reply…". DeepTutor's own web app shows an error instead.
- **Regenerate replaces the last reply** (deletes it and writes a new one); no branches.
- **After `done`, DeepTutor sends one more event, `session_meta`** (the chat's new title), sometimes a moment later. Resuming a finished turn replays its events, `done` and `session_meta`; resuming from its last seq sends `session_meta` and a closing `done`.
  - A late `session_meta` must never start a reply. Before 2026-11-03 it did when it arrived after the app had let go of the finished reply: an empty "Working…" that never ended, a stop button with nothing to stop, and a message box that couldn't send.
  - Now the connection hands events after a turn's `done` to `onLateEvent`, which refreshes the title, and the live store never starts a reply from `done` or `session_meta`.
  - A refused stop checks the session and, if nothing is running, clears the reply showing.
- **Titles:** sessions stay "New conversation" in Chat mode, so the app shows the first message instead.
- **Choices:** `GET /api/settings/llm-options` lists the models an admin granted to the account (`active` is the default). `GET /api/tools` lists tools; a chat can switch on those marked `toggleable` and not tied to another mode.

## Modes (slice 2, 2026-11-01)

The composer's mode chip picks DeepTutor's mode for a turn, with its settings: Quiz (questions, difficulty), Research (depth, write-up), Visualize (quality). Tools belong to Chat. Each was recorded live on 1.7.1, and `npm run probe:deeptutor -- --modes` checks them.

| Mode (`capability`) | What streams | What the app shows |
|---|---|---|
| Solve (`deep_solve`) | The agent loop with `solve_plan` (args: `analysis`, `steps[{goal}]`) and `solve_finish_step` (`step_id`, `summary`), then the answer | The plan and each finished step in their places, then the answer |
| Quiz (`deep_question`) | Stages exploring → planning → quizzing. Each question arrives whole as a `content` event with `call_kind: "quiz_question_emitted"` and a `qa_pair` (`question_id`, `question`, `question_type`, `options {A: …}`, `correct_answer`, `explanation`, `difficulty`). `result.summary.results[].qa_pair` has them all | Question cards: choices check at once; blanks and true/false by text; written answers are revealed, then you mark them. **Submit Answers** posts `POST /api/sessions/{id}/quiz-results {turn_id, answers[]}`, which adds your results as a message and to DeepTutor's question bank |
| Research (`deep_research`) | **Two turns.** First rephrasing → decomposing, then `result` with `outline_preview: true`, `topic`, `sub_topics [{title, overview}]` and `research_config`. The research runs as a second turn: same session, `content` = the topic, `config` = `research_config` + `confirmed_outline`, `persist_user_message: false`. It goes researching (literature, preprints, web) → reporting, streaming the report a section at a time (`llm_final_response`). "Quick" took about 9 minutes and wrote about 63k characters | The outline with **Start Research**. The research then streams below it, with its stages |
| Visualize (`visualize`) | analyzing → generating (`submit_visualization`), then `result` with `render_type` (`chartjs`, `svg`, `mermaid`, `mindmap`, `html`, `geogebra`…), `payload.data`, `presentation` and `code`. The text answer is the payload as a code block | The drawing in a sandboxed web view (`incognito`, links open in the browser), using pinned Chart.js 4.4.6 / Mermaid 11.4.1 from jsDelivr (MIT); SVG without scripts. GeoGebra and the rest offer the web app. The code sits under **Code** |
| Ask Questions (`ask_questions`) | `progress` events carry `ask_user_draft` as the questions are written; the `ask_user` tool result's `tool_metadata.ask_user` (`intro`, `questions [{id, header, prompt, options [{label, description}], multi_select, allow_free_text, placeholder}]`) leaves the turn waiting. **No `wait_for_input` event.** The reply is `submit_user_reply {turn_id, command_id, answers [{questionId, text}]}`; a saved `progress` event with `trace_kind: "user_reply"` records the answers | The question card: options (one or several) and room to type; **Send Answers**. A reopened chat shows the answers given |
| Math animation (`math_animator`) | Fails at once on our server: "requires optional dependencies" (the image lacks `deeptutor[math-animator]`) | Not offered (Video lesson likewise) |

- Mode turns stream their opening text with a leading newline, which DeepTutor trims when saving; compare trimmed.
- Stages come as `stage_start`/`stage_end` with names (`rephrasing`, `quizzing`, …); the app shows them as ticked steps with our own names.

## Attachments and references (slice 3, 2026-11-01)

- **Attachments go inline.** Each turn's `attachments` are `{type: "image"|"file", filename, base64, mime_type}`; there is no upload step.
  - DeepTutor accepts images, PDFs, Office files and text-like files.
  - Limits come from `GET /api/settings/chat-attachments` (`effective.max_file_bytes`, `max_total_bytes`): 20 MB a file and 25 MB a message on our server.
  - DeepTutor reads files itself; the saved message keeps `extracted_text`.
- **Saved attachments** are `{type, url, filename, mime_type, id}` (base64 emptied). `url` is `/files/attachments/<session>/<id>/<name>`, served through the front end with the sign-in (401 without). The app loads photos with `Authorization: Bearer`.
- **References:**
  - `notebook_references` is `[{notebook_id}]` (whole notebooks);
  - `history_references` is earlier session ids;
  - `knowledge_bases` is names, kept by the session like its tools.
  - The saved user message's `metadata.request_snapshot` records them (`notebookReferences`, `historyReferences`, `knowledgeBases`), and the app shows them as chips.
- **Knowledge bases** are listed by `GET /api/knowledge-bases` (`name`, `status`, …). The app's Knowledge Center makes them (see B3).
- **Rename:** `PATCH /api/sessions/{id} {title}`.
- **Find in Chat** searches the shown messages on the phone and scrolls to the one you tap.
- `npm run probe:deeptutor -- --refs` checks all of it against the server (passes on 1.7.1).

## The DeepTutor space (2026-11-03)

The owner asked for DeepTutor to be treated equally with Open WebUI: a home page, its settings and the rest of DeepTutor, not just a chat list. The space now has the same structure as Open WebUI's, organised the way DeepTutor's own web app is (its "Modern" layout, 1.7.1, read as a spec).

- **The same frame in both spaces.** One top bar (sidebar button, the switch to the other space, title, new chat, menu), one sidebar frame (swipe open from anywhere; name at the top; New Chat, Search; you at the bottom), one Settings modal with tabs, and one Connection page. Each space fills them with its own content (`features/sidebar/SpaceBar`, `SpaceDrawer`, `parts`; `features/settings/SettingsFrame`, `DetailScreen`).
- **Home** (`/learn`) is a new chat, like Open WebUI's: a greeting for the time of day, the input in the middle, then DeepTutor's **Ideas for you** and the modes to **Start with**. An idea fills the input; the refresh button asks for a new set.
- **The sidebar** has DeepTutor's five shelves as tabs:
  - **Home:** Calendar, Task Board, Co-Writer, then your chats (Pinned, Today, Within a week, Earlier).
  - **Learning:** New Learning Activity, All Learning, and the chats held in learning activities (each opens in its activity).
  - **Resources:** All Resources, Chat History, Favorites, Learning Journal, Question Bank, Knowledge Center.
  - **Partners:** All Partners, New Partner, New Group.
  - **Personalization:** All Personalization, My Agents, Personas, Skills, MCP Services, CLI Apps, Memory.
  - Learner accounts get Home (without Co-Writer) and Learning only, as in DeepTutor.
  - Pages the app doesn't have natively open DeepTutor's own page in the app, signed in, under the same bar.
  - Each chat's menu: Rename, Pin or Unpin, Archive, Delete. The chat screen's menu has Pin and Archive too.
- **The account menu:** Admin (admins: DeepTutor's user management), Settings, Switch to or Connect Open WebUI, Connection, Sign Out.
- **Settings:**
  - **General:** the app's theme and notifications, then DeepTutor's reply language and More DeepTutor Settings (its own page).
  - **Account:** who you are, Change Password, your picture (DeepTutor's profile page), Sign Out.
  - **Archived Chats:** search, open, restore or delete, Restore All.
  - **About.**
- **Either space works alone.** With neither signed in (a first launch, or after signing out of both), the app opens on a **welcome screen** that offers Open WebUI or DeepTutor as equals. Each choice has an ⓘ explainer in our own words: what it is, what it's good for, how it differs from the other, and what you need to sign in. "I'm just a user and don't have a server" explains that MavieChat connects to a server someone runs, and links the official set-up guides for whoever does it (Open WebUI's Getting Started, DeepTutor on GitHub). The cards use our own icons, not the products' logos (the owner chose this on 2026-11-03). With only one signed in, the app opens there. Each sign-in screen offers the other ("Sign in to DeepTutor instead", "Sign in to Open WebUI instead"), and one opened from the welcome screen has a way back to it. Notifications switch on without an Open WebUI account (DeepTutor's replies only need the phone's push token); the test notification still goes through Open WebUI's account. Signing out of Open WebUI only takes the phone off the relay for that account, so DeepTutor's notifications carry on.

### Server facts (1.7.1, checked with `npm run probe:deeptutor -- --space`)

- **Filing.** `GET /api/sessions` without `workspace_id` returns every chat with its `preferences`.
  - DeepTutor's sidebar leaves out archived chats (`archived`), side chats (`parent_session_id`) and note chats (`note_document_id`).
  - It files learning chats under Learning:
    - a mastery path (`workspace_mode: mastery_path` + `mastery_path_id`) opens at `/learning/mastery/<path>/sessions/<id>`;
    - a reading collection (`immersive_reading` + `reading_workspace_id`) opens at `/learning/reading/<collection>/sessions/<id>`;
    - a book page (`book_id`, `book_page_id`) opens at `/learning/books/<book>/pages/<page>?chat=<id>`;
    - a video (`immersive_watching`) opens at `/learning/watching/<id>`.
  - The app applies the same rules (`listedUnder`, `learningPath`).
- **Pin and archive:** `PATCH /api/sessions/{id}/organization` with `{pinned}` or `{archived}`; archiving takes the chat's side chats along. There is no archived-only list, so Archived Chats filters the full list.
- **Profile:** `GET /api/auth/profile` (`preset` is `standard`, `custom` or `learner`; `can_change_password`, `must_change_password`).
- **Password:** `PUT /api/auth/profile/password {current_password, new_password}`. The new one needs at least 8 characters and must differ; a wrong current one answers 400 and changes nothing. Tokens stay valid.
- **Languages:** `GET /api/settings/ui` → `theme`, `language` (DeepTutor's interface), `response_language` (17 reply languages, Malay included); `PUT` merges only the fields sent.
- **Ideas:** `GET /api/dashboard/suggestions` → `{suggestions: [{label, prompt}], stale}`; it answers at once and writes a fresh set behind the answer when stale (the app asks again every 3.5 s, up to 10 times). `POST /api/dashboard/suggestions/refresh` writes a new set now (uses DeepTutor's model). An empty list means DeepTutor has nothing about you to go on yet.

## Practice and Question Bank (B1, 2026-11-03)

The owner asked for DeepTutor's quizzes to be native beyond the chat's Quiz mode. **Practice** (Learning shelf) and **Question Bank** (Resources shelf) are now native screens; DeepTutor's web app shows both on one page (`/learning/practice`, `/space/questions`).

- **Practice:**
  - Today's counts: due now, mistakes, in your bank, reviewed today; categories if you made any; **Start Review**.
  - A round asks each due question in turn:
    - Choice questions are checked by DeepTutor: right → **Next**, wrong → **Practise Again**, which brings it back at the end of the round.
    - Written ones show DeepTutor's answer and you rate yourself: Again, Hard, Good, Easy.
    - **I Know This** and **Skip** are there too.
  - With nothing due, it says when the next review is and offers **Make a Quiz**, which opens the home page in Quiz mode.
- **Question Bank:**
  - Search; filters for All, Mistakes, Bookmarked and your categories.
  - Each question opens with the choices (yours and the right one marked) or both answers, and the explanation.
  - From there: the chat it came from, **Practise This Question**, Bookmark, Delete.

### Server facts (1.7.1, checked with `npm run probe:deeptutor -- --practice`)

- **Saving.** Quiz answers reach the bank through `POST /api/sessions/{id}/quiz-results` (the chat's Submit Answers).
  - The bank is `/api/question-notebook`: `entries` (filters `mistakes_only`, `bookmarked`, `category_id`, `search`, `limit`/`offset`; answers `{items, total}`), `PATCH entries/{id}` (`bookmarked`, `resolved`), `DELETE entries/{id}`, `categories`, `stats`.
  - Deleting a chat hides its questions but doesn't delete them.
- **When questions are due.** A wrong answer is due the next day; a right one three days later. After a review, the schedule decides:
  - **again**: 10 minutes;
  - **hard**: ×1.2;
  - **good**: 3 days at first, then × ease;
  - **easy**: like good, ×1.3.
- **Practice** is `/api/question-notebook/practice`:
  - `summary?timezone=` → total, mistakes, due, overdue, reviewed today, next due;
  - `queue?timezone=&category_id=&limit=` → `[{entry, state}]`, due now;
  - `questions/{id}` → one question, due or not;
  - `questions/{id}/check {answer}` → `{correct}`, true or false for choice questions and null when it can't check.
- **Reviews:** `questions/{id}/review {request_id, version, rating, answer, self_report}`.
  - The same `request_id` gets the same answer, so a lost reply can be retried.
  - An old `version` gets 409.
  - A wrong objective answer rated anything but `again` gets 422.

## Favorites, Learning Journal and Chat History (B2, 2026-11-03)

Three more of DeepTutor's pages are native, all on the Resources shelf.

- **Favorites** (DeepTutor's notebooks):
  - The list: name, description, item count, date. **+** makes a notebook. Each one's menu: Chat About It, Rename, Delete.
  - A notebook shows what's saved in it; each item opens in full (question and answer, as Markdown) with Copy, Rename and Remove.
  - The notebook menu: Chat About It, Share as Markdown, Rename, Delete Notebook.
  - **Chat About It** opens the home page with the notebook already referenced on the message.
- **Learning Journal**, read-only: your goal (topic, why, level), where the last session left off and what's next, and what you have learned. DeepTutor writes it itself through its `learning_update` tool.
- **Chat History:**
  - Every chat, learning and side chats included.
  - Search runs on the server, over titles and message text, and each result shows the words that matched.
  - Filters as on DeepTutor's page: Active, Archived, or both; All, Main Chats or Tutor Threads.
  - Each chat's menu: Use in a New Chat (an earlier-chat reference), Archive or Restore, Delete.
  - Learning chats open in their activity.

### Server facts (1.7.1, checked with `npm run probe:deeptutor -- --library`)

- **Notebooks:**
  - `GET /api/notebooks` → `{notebooks, total}`, each with `record_count` (and `unreadable` for a damaged file);
  - `GET /api/notebooks/{id}` → with `records` (`id, type, title, summary, user_query, output, metadata, created_at`);
  - `PUT /api/notebooks/{id}` (`name`, `description`, `color`, `icon`);
  - `PUT /api/notebooks/{id}/records/{rid}` sends only the fields given;
  - `DELETE` both;
  - `GET /api/notebooks/{id}/export` → Markdown text.
- **Journal:** `GET /api/learning-journal` → `mission {topic, why, level}`, `last_session {summary, next_focus}`, `records [{id, title, insight, created_at}]` (newest first), plus the slice DeepTutor feeds into each turn (`injected_context`).
- **Search:** `GET /api/sessions/search` answers with `match_excerpt` (a window around the first match in the best message), `match_role`, `match_message_id`, `last_message`, `capability`, `message_count` and `preferences`. It drops `match_content`.
- **Side chats** ("tutor threads") have `preferences.session_kind: "selection_tutor"` and a `parent_session_id`.

## Knowledge Center (B3, 2026-11-03)

DeepTutor's knowledge bases are native, on the Resources shelf.

- **The list:** each knowledge base with its status (Ready, Indexing and how far, Indexing failed, Needs re-indexing), documents, engine and a Default badge. It refreshes itself while one indexes. Each one's menu: Use in a New Chat, Make Default, Delete.
- **+** opens New Knowledge Base:
  - a name, checked against DeepTutor's rules as you type;
  - an engine. Only engines the server has installed and that need no outside account are offered. Each is checked with DeepTutor's readiness check, and one that isn't ready shows what it lacks;
  - for PageIndex, Flash (quicker) or Standard (more thorough);
  - documents from Files, filtered to what the engine takes (PageIndex OSS: PDFs only).
- **A knowledge base** shows its status, with a progress bar while it indexes and DeepTutor's message when it failed, then its documents. You can add documents or remove one. Its menu: Use in a New Chat, Add Documents, Re-index (Try Indexing Again after a failure), Make Default, More on the Web, Delete Knowledge Base. One connected to an outside source (a folder, Obsidian…) is read-only.
- **Use in a New Chat** opens the home page with that knowledge base picked (`/learn?kb=`). The chat keeps it, like DeepTutor's composer.
- **Our server:** PageIndex OSS works now; it uses the chat model and takes PDFs. LlamaIndex needs an embedding model, which an admin adds in DeepTutor's model settings; until then the app shows it as not ready, with DeepTutor's reason.

### Server facts (1.7.1, checked with `npm run probe:deeptutor -- --knowledge`)

- **Create:** `POST /api/knowledge-bases` as multipart: `name`, `rag_provider`, `pageindex_mode` (`flash` or `standard`), `files` (any number, or none) → `{message, name, files, task_id, id}`. Indexing runs in the background.
- **Names:** at most 120 characters, none of `< > : " / \ | ? * # %`, not `.` or `..`.
- **State:** the list (and `GET /{kb}`) gives `status` (`initializing`, `processing`, `ready`, `error`, `needs_reindex`, `unavailable`), `statistics` (`raw_documents`, `rag_provider`, `needs_reindex`), `metadata` (`description`, `last_indexed_at`), `is_default`, `read_only`.
- **Progress:** `GET /{kb}/progress` → `{stage, progress_percent, current, total, file_name, message}`. Stages: `initializing`, `processing_documents`, `processing_file`, `completed`, `error`; `not_started` when there is nothing to report. A one-page PDF indexes in about 2 seconds.
- **Engines:** `GET /api/knowledge-bases/rag-providers` → `{providers[{id, name, description, configured, setup_required, requires_api_key}]}`. Readiness: `GET /api/knowledge-bases/rag-pipelines/{id}/preflight` → `{ok, checks[{label, detail, ok, optional}]}`.
- **Documents:** `GET /{kb}/files` → `{files[{name, type, size, modified, mime_type}]}`. `POST /{kb}/upload` (multipart `files`) adds and indexes them; the status flips to `processing` before the call returns.
- **Removing a document:** `DELETE /{kb}/files/{path}` → `{status, path, was_indexed}`. PageIndex drops it from its index too. Other engines keep finding its text until a re-index, so the app offers one.
- **Re-index:** `POST /{kb}/reindex` (an empty form is enough); also how a failed one is tried again. Refused (409) while a run is going.
- **Default:** `PUT /api/knowledge-bases/default/{kb}`. DeepTutor uses the default where a feature needs a knowledge base and none is picked. A default that was deleted is ignored.
- **Delete:** `DELETE /{kb}`. Connected and legacy knowledge bases refuse file changes (409).
- **Size:** DeepTutor takes up to 200 MB a file. Its web front end streams uploads to the backend, and our Traefik route sets no limit.
- **A chat** that picks a PageIndex knowledge base searches it through PageIndex's own tools; other engines go through the `rag` tool.

## Calendar and Task Board (B4, 2026-11-03)

Both are native, on the Home shelf.

- **Task Board:** To do, In progress and Done, one column at a time (tabs with counts and colours), filtered by All dates, Due today or This week.
  - Each task shows its note, due day (red when overdue), its calendar time blocks and linked chats.
  - **‹ ›** move a task between columns; its menu moves it anywhere or archives it.
  - **+** adds a task (title, note, due day).
  - Tapping a task edits it (title, note, due day, column; Archive or Restore).
  - The menu: Show Archived, Column Colours, Open Calendar.
- **Calendar:** the month (from Monday) with a dot for each colour of item on a day and a ring for days you studied, then the chosen day.
  - The day lists events, tasks due, reviews coming due and automations. All-day ones come first; multi-day ones show on each day.
  - **+** adds an event: title, all day, start and end (our own day and time pickers, since build 4 has no native one), repeat (presets, ending never, on a day or after some times; a custom rule from the web is kept), reminders, calendar, place and notes.
  - Tapping an item shows it:
    - an event can be edited or deleted. For a repeating one, you choose this date, this and the following, or all. A delete can be undone from the toast;
    - a task can be marked done, reopened or edited;
    - reviews open Practice;
    - an automation opens its chat or is stopped.
  - Search finds events and jumps to their next date.
  - **Calendars and What Shows** turns calendars on and off, adds, renames and deletes them (not the default), and turns tasks, reviews, automations and footprints on and off.
  - Export (an .ics file) stays on the web: build 4 has no file-sharing module.
- **Chats and tasks:** a DeepTutor chat's menu has **Linked Tasks**:
  - tick tasks to link them;
  - **Show task status** colours the chat in the sidebar with its most recently linked task's column.
- **Reminders** are stored and shown in DeepTutor's web app; the phone doesn't notify yet.

### Server facts (1.7.1, checked with `npm run probe:deeptutor -- --calendar`)

- **Board:**
  - `GET /api/task-board` → `{cards, colors{todo, doing, done}, session_links[{workspace_id, session_id, task_ids, status_link_enabled}], revision}`. Each change answers with the whole board.
  - `POST /cards {title, note?, due_date?}` adds to To do.
  - `PATCH /cards/{id}` with any of `title, note, status, archived, due_date` (`null` clears the date; other fields refuse null).
  - `PUT /colors`.
  - There is no delete: cards are archived.
  - Cards come in the order they were made; titles at most 160 characters, notes 2,000. A due date is a plain local day.
  - One board per workspace; the app uses the default one (no header).
- **Chat links:**
  - `PUT /api/task-board/sessions/{id} {workspace_id: '', task_ids}` replaces the list; linking a new one turns the status colour back on.
  - `PATCH …/status {workspace_id: '', enabled}`.
  - Every chat (not side chats) gives the model the workspace's open tasks, up to 40, as reference data. Linked ones come first, marked `linked_to_conversation`. The probe's chat named its linked task.
  - A turn can also link tasks with `config.linked_task_ids`.
- **Calendar (`/api/calendar`):**
  - `GET /calendars` → `{calendars[{id, name, color, visible, position, is_default}], revision}`; `POST`, `PATCH /{id}` (name, color, visible, position) and `DELETE /{id}`. Deleting a calendar deletes its events; the default one can't be deleted.
  - `GET /events?start&end&tz` (at most 400 days) → `{occurrences[{id, event_id, series_id, occurrence, recurring, calendar_id, title, notes, location, all_day, start, end, tzid, rrule, reminders, color, task_id, task_workspace_id, source, reminder_times}]}`.
    - All-day events use plain days, the end exclusive; timed ones UTC instants.
    - `source` is `user`, `dito` (DeepTutor made it) or `import`.
  - `POST /events` (`calendar_id` null for the default, `tzid` the phone's zone, `rrule` without "RRULE:", `reminders` as minutes before, up to five, negative only for all-day ones, `task_id` + `task_workspace_id` for a time block).
  - `PATCH /events/{id} {changes, scope: this|following|all, occurrence}`:
    - send only what changed, with start, end, all_day and tzid together; the server moves a series by the start's shift;
    - **"following" splits the series into a new event with its own id**, so find its dates by title, not by the old id.
  - `DELETE /events/{id}?scope&occurrence` → `{revision, undo_token}`; `POST /undo/{token}` within 15 minutes.
  - `GET /search?q&limit` → events with `next_start`, coming ones first.
  - `GET /layers?start&end&tz` → `reviews[{date, mastery, practice, paths}]`, `automations[{id, job_id, name, message, at, kind, expr, every_seconds, session_id}]`, `footprints[{date, session_count, sessions, practice_reviews, mastery_evidence}]`.
  - `DELETE /automations/{job_id}` stops one; `GET /task-blocks` → `{task_id: count}`; `GET /export.ics`; `GET /stream` is a change feed (Server-Sent Events) the app doesn't use.
- Learner accounts may use both (DeepTutor files them under chat).

## All Learning and Mastery Path (B5.1, 2026-11-03)

Learning activities come in four slices: **B5.1** the hub and mastery paths, **B5.2** books, **B5.3** reading, **B5.4** videos. Until a kind's slice lands, it opens DeepTutor's own page.

- **All Learning** (Learning shelf) is DeepTutor's hub:
  - **Needs your attention:** paths with reviews due, books paused (with DeepTutor's reason) or still being written.
  - **Your learning:** every activity, newest first, with progress (pages read, points mastered). Filters All, Books, Mastery Path, Practice, Reading (Reading takes videos too), a search box, 24 at a time.
  - It reads again every 30 s while shown, as DeepTutor's page does.
  - A path opens natively, a practice item on its own question (`/learn/practice?entry=`), a book natively (B5.2); collections and videos open DeepTutor's pages.
- **New Learning Activity** offers the ways this account may start: the server has the page on (`/api/modules`), and a learner's policy allows the surface (`allowed_surfaces`; for Mastery Path also the `mastery_path` mode, since a learner's tutor turns are refused without it). Each card has a line and three points in our own words.
- **Mastery Path:**
  - **The list:** a banner when reviews are due ("Start Review" opens a review chat naming them), then a card per path: emblem, name, goal, progress, modules, chats, date.
  - **New path:** your goal (up to 2,000 characters) and one of DeepTutor's eight emblems, then optional materials: knowledge bases, Favorites notebooks (their first 16 records go along) and earlier chats (their last message). DeepTutor names the path; the app then starts the **outline chat** with the tutor straight away, as DeepTutor does. (Books, question sets, Co-Writer drafts and partners as materials: later.)
  - **The path page:** emblem and goal, what it was built from, points mastered; **Next up** (design the outline, with the tutor or by hand, when there's none; else the next point, with Continue, Answer Your Tutor, Begin or Review); the outline (tap a point: the bar to pass, your answers, next review, "I already know this" or back); reviews (due first by risk; ▶ reviews one; Start Review) with the review plan and recall target; what the tutor knows about you; the path's chats and New Chat. Menu: Rename, Edit Modules, Reset Progress, More on the Web, Delete Path.
  - **Edit Modules:** names, kinds (concept, memory, procedure, design), order, add and remove, checked against DeepTutor's rules before saving. Unlike DeepTutor's own editor, the app keeps each module's one-line objective.
  - **Path chats** run in the ordinary DeepTutor chat screen, with a bar on top: the path (tap for its page), points mastered, and Outline / Study / Review (Study waits for an outline). The tutor's question cards are native: lettered options or your own words, groups of parts answered together, Skip, then the ruling (right, partly, not quite, or not graded) with the answer and why. A newly mastered point gets a note. New chats start with three starters per mode.
  - Your own review plans (making, editing, copying) stay on the web; the app picks among them.
  - Not yet: the board view, the composer's hint line (an extra model call per turn), the page images the tutor shows from your documents, the hand-off cards in ordinary chats.

### Server facts (1.7.1, checked with `npm run probe:deeptutor -- --learning`)

- **Hub:** `GET /api/dashboard/learning-index` → `{sources: {books, mastery, reading, watching, practice}, failed[]}`, each already filtered by what the account may open. `GET /api/modules` → `{modules[{id, enabled, ready, navigation[], capabilities[]}]}`; a learner's limits come with `GET /api/auth/status` (`learning_policy.allowed_surfaces`, `allowed_capabilities`).
- **Paths** are `/api/mastery-paths`:
  - `GET /topics` (active ones, newest first), `GET /topics/{id}`, `POST /topics {goal, emoji, sources[], modules[]}` (DeepTutor names it; with modules given, study can start at once), `PUT /topics/{id}/map {modules}` (ids kept keep their evidence), `GET /topics/{id}/sessions`, `PUT /topics/{id}/sessions/{sid}/mode {mode}`, `POST /topics/{id}/objectives/{kp}/override {mastered, note}`, `PUT /topics/{id}/review-strategy {template_id}`, `PUT /topics/{id}/review-settings {desired_retention}` (0.7–0.99), `GET /review-strategies` (four presets on our server).
  - The older `/progress/{id}` routes take the same id: `GET …/objectives/{kp}` (attempts, the bar, the review), `PATCH {name}`, `POST …/redo` (reset), `DELETE`.
- **A path chat** sends on every turn `capability: mastery_path`, `workspace_mode: mastery_path`, `mastery_path_id`, and `mastery_session_mode` (null keeps the chat's). Answering a card is a new turn whose text is the option's letter (or your words) with `mastery_answer {question_id, text, answers?}`; skipping sends `mastery_skip {question_id}`. Cards arrive as `tool_result` metadata `mastery_question`; rulings as `mastery_grade.result`, graded at the start of the answering turn; also `mastery_skip_question`, `mastery_answer_rejected`, `mastery_mode`, `mastery_build`.
- **Posing a question ends the turn** (the next message answers it), and the tutor usually poses the next one after a ruling.
- **Just after a turn ends, the path stays locked for a moment:** a change to it (map, override, settings, rename, reset, delete) answers 409 "Active learning turn could not be stopped". The app retries such changes three times over about ten seconds (`whenPathFree`).
- **The tutor's cards are kept in the Question Bank** as practice questions (`source: mastery_path`, with `mastery_path_id`). They outlive the path, so the probe deletes its own.
- Deleting a path leaves its chats as ordinary chats.

## Books (B5.2, 2026-11-03)

DeepTutor writes a book from what you want to learn: a proposal to review, an outline of chapters to edit, then every chapter's page written in full, in the background. All of it is native now.

- **Books** (`/learn/books`, from All Learning's Books filter or a book activity): your books and those shared with you, newest first, with search past three books. Each card shows its step (Proposal, Outline, Writing, Paused) unless it's ready, "Shared · read only / you can edit", reading progress, chapters, date, and what tapping does next (Continue setup, Start reading, Continue reading). Your own books can be deleted from the card's menu. The list reads again every 30 s.
- **New book** (`/learn/books/new`): what you want to learn, the depth (Brief, Standard, Deep) and the language (Automatic follows how you asked; 14 more), then optional sources: knowledge bases (also searched while each page is written and by the page chats), Favorites notebooks (first 16 records), earlier chats (their last message) and your other books (their outline). Up to 32. DeepTutor answers with a proposal in under a minute. (Question-bank entries, Co-Writer drafts, single files inside a knowledge base and partners' chats as sources: later.)
- **The proposal:** title, description, scope, level and about how many chapters (2–12), and the knowledge bases it uses. "Make the Outline" sends DeepTutor to read the sources and draft the chapters, then check them; the screen follows it live (reading, drafting, checking, passages found) and says you can leave: DeepTutor carries on.
- **The outline:** each chapter's title and kind (Theory, Derivation, History, Practice, Concept), with its summary and objectives a tap away; reorder, remove, add. What pages may contain (prose always; each other kind is one more model call per chapter), and when to write: every chapter now, or each one when you first open it. DeepTutor's estimate of words and minutes (from the right address: its own web app asks the wrong one, so it never shows there). "Start Writing" costs nothing by itself.
- **The book** (once it's being written): title, description, progress; a strip while it's writing (which chapter, which block of how many, chapters done, elapsed time, Pause), paused (why, Resume) or stopped (DeepTutor restarted: Continue); failed chapters and blocks with the causes in plain words; Continue reading; the contents (the overview with a map icon, numbered chapters, deep dives indented; a mark for written, being written, not yet, failed; bookmarks). Menu: Share as Markdown (the export, through the share sheet), Open in DeepTutor Web App, Delete Book.
- **A page:** what the chapter is for, then its blocks, all native: prose with its key takeaway, text, callouts, quick checks (your answers kept with your progress and shown again when you come back; true/false questions get True and False buttons), flash cards, code, timelines, figures and interactive pages (SVG, Mermaid, Chart.js and HTML in a sandboxed web view; interactive pages get KaTeX for their maths), the overview's chapter map (a Mermaid diagram drawn from DeepTutor's graph, and a tappable chapter index), Go Deeper topics (open one already written, or write a new page on it after a confirmation: minutes), your notes (read only) and animations (played in the web view). Blocks arrive one by one while a page is written; a failed block says why and offers Try Again; a failed or partly written page offers to try its failed parts again. Previous and Next in the book's order; Bookmark; Write This Page Again (after a confirmation); a visit is recorded once per page shown.
- **"First chapter only" books** write a chapter when you first open it, as DeepTutor's reader does. In a book being written in order, an unwritten chapter offers "Write It Now" (no extra cost: it moves up the queue).
- **Chat about a page:** "Ask the Tutor About This Page" opens the page's chat (each page keeps one), or a new one with three starters. The tutor reads the page with every message, and searches the book's knowledge bases; your own tool settings apply (no tool list is sent, as on DeepTutor). The chat runs in the ordinary chat screen under a bar naming the page (tap to read it), and the sidebar, Chat History and the hub open it natively.
- Not yet: inserting, moving, editing or deleting blocks; adding notes; "Add extra practice" after a wrong answer; saved highlights; the knowledge-base change warnings (and Mark as Seen); Rebuild (destructive; on the web).

### Server facts (1.7.1, checked with `npm run probe:deeptutor -- --books`)

- **REST** (under `/api`): `GET /dashboard/learning-library/books` → `{items, unavailable_workspaces, can_create}`; `GET /books/{id}?include_blocks=false` → `{book, spine, pages, progress, generation}` (blocks come per page: `GET /books/{id}/pages/{page}`); `GET /books/{id}/spine`; `GET /books/{id}/export` (Markdown); `DELETE /books/{id}` (own books only); `GET /books/block-types`; `GET /books/estimate-basis?depth=`; `POST /books/confirm-spine {book_id, spine, auto_compile, block_types, expected_revision}` (only REST stores `block_types`); `POST /books/pause|resume {book_id, expected_revision}`; `POST /books/progress/visit|bookmark {book_id, page_id}` (bookmark toggles); `POST /books/quiz-attempt {book_id, page_id, block_id, question_id, user_answer, is_correct, submission_id}` (with a verdict it also goes into DeepTutor's learning record); `POST /books/page-chat-session {book_id, page_id, session_id}`; `POST /books/deep-dive` (answers when the new page is written).
- **`/ws/books`** takes the same `Cookie` sign-in as `/ws` (never a token in the address). One socket per action, as DeepTutor's web app does (results carry no id): `create`, `confirm_proposal`, `compile_page`, `regenerate_block`, each answered by `{type}_result` or `{type: error, content, status?, code?}`. A watching socket sends `{type: subscribe, book_id, after_seq}`: DeepTutor replays up to 400 recent events after that number, then streams; `{type: subscribed, latest_seq, reset}` with `reset: true` means its stream restarted (start over from 0).
- **Events** are `{type, source: book_engine, stage, content, metadata, seq}`; book events are `progress` with `metadata.kind`: `proposal_ready`, `exploration_ready {queries, coverage}`, `exploration_failed`, `spine_round {round}`, `spine_ready`, `overview_ready`, `page_compile_started {page_id, title}`, `page_planning`, `page_planned {block_types}`, `block_started {block_type}`, `block_ready`/`block_error`, `page_compiled`, `compilation_paused`, `book_ready`. Making the outline is wrapped in `stage_start`/`stage_end` `spine`, so a screen opened midway sees it from the replay.
- **Work carries on without the app:** a dropped action socket doesn't stop DeepTutor; read the book again. Opening (`GET`) your own book that says it's being written but isn't (after a restart) starts the writing again.
- **Revisions:** every change bumps `book.revision`; content changes check `expected_revision` strictly (409 `book_revision_conflict`), writing commands don't. The app reads the book again and tries once more.
- **"First chapter only"** books report `interrupted` whenever nothing is being written; the app treats them as idle.
- Errors may come as `{detail: {code, message}}`; the app reads both.
- The probe's book: brief, cut to two chapters with prose and a quick check, first chapter only; one chapter written (three prose blocks and a five-question check, about three minutes), its quiz answer recorded without a verdict (so no learning record), a page chat answered and filed under the page, paused, then the chat and the book deleted.

## M1.5 checklist

| | Item |
|---|---|
| [~] | Spike: native sign-in (cookie store or Bearer); a web view reusing the sign-in; `GET /api/sessions` and a notebook record written from the app. Done from Node: Bearer sign-in, sessions, notebook record. The web view and the phone's cookie store wait for store build 3 |
| [~] | Saved servers and a switcher (Keychain per server; caches kept apart). Done: an Open WebUI and a DeepTutor sign-in side by side, each in the Keychain, with DeepTutor's data cached under its own keys. The switch button sits at the top left in both spaces (beside the sidebar button in Open WebUI, beside Back on DeepTutor's inner screens), and Connect DeepTutor is in the account menu. Each space records itself while it shows, and a launch opens straight into the last one (read before the first frame, so Open WebUI doesn't flash first; a launch from a notification goes to its chat). A longer list (several Open WebUI servers) comes with M4's scratch instance |
| [x] | `packages/deeptutor-protocol`, a DeepTutor contract probe (`npm run probe:deeptutor`), and fixtures per version (`tools/contract-probe/fixtures/deeptutor-1.7.1/`). |
| [x] | `.ref/deeptutor` pinned at the deployed tag (`packages/deeptutor-protocol/src/support.json`), and the copy check extended to cover it. |
| [x] | The DeepTutor space. First a web view under a native bar (store build 3); since 2026-11-03 a native space equal to Open WebUI's: home, sidebar with DeepTutor's five shelves, Settings, Connection (see "The DeepTutor space"). DeepTutor's pages the app doesn't have natively open in the web view, signed in, under the same bar.
| [x] | "Reference DeepTutor Chat" in the Open WebUI + menu (a `text` attachment, see above). |
| [x] | "Send to DeepTutor" in the Open WebUI chat menu (saved chats only): the shown branch as Markdown, filed as a `chat` record in the "From MavieChat" notebook, with our own summary. |
| [ ] | Phone checks: switch both ways without signing in again; both cross-reference directions; an expired DeepTutor sign-in; offline. |
| [~] | Native DeepTutor chat over the `/ws` turn protocol 2.0 (see "Native chat", "Modes" and "Attachments and references"). Slices 1–3 are done: Chat; Solve, Quiz, Research, Visualize, Ask Questions; attachments, knowledge bases, notebook and earlier-chat references, rename, find. Learning activities (mastery paths, reading, books, videos) and the animation modes open in DeepTutor's own pages. |
