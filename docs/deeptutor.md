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

The DeepTutor space opens on a native list of your DeepTutor chats. **New chat** and each chat are native screens in DeepTutor's **Chat** mode:
- streaming replies with their reasoning (folded), each tool call where it happened (with its result), and sources;
- stop, regenerate, copy;
- the model (from the account's granted models) and the switchable tools, per chat;
- a reply resumes after a dropped connection or a trip to the background, and a reply started on another device shows as it streams.

Chats in other modes (Solve, Quiz, Research, Visualize…) open read-only with **Open in DeepTutor Web App**. The web app is also in the home menu.

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
- **Knowledge bases** are listed by `GET /api/knowledge-bases` (`name`, `status`, …). Building one needs an embedding model (not configured on our server yet); until then the list is empty.
- **Rename:** `PATCH /api/sessions/{id} {title}`.
- **Find in Chat** searches the shown messages on the phone and scrolls to the one you tap.
- `npm run probe:deeptutor -- --refs` checks all of it against the server (passes on 1.7.1).

## M1.5 checklist

| | Item |
|---|---|
| [~] | Spike: native sign-in (cookie store or Bearer); a web view reusing the sign-in; `GET /api/sessions` and a notebook record written from the app. Done from Node: Bearer sign-in, sessions, notebook record. The web view and the phone's cookie store wait for store build 3 |
| [~] | Saved servers and a switcher (Keychain per server; caches kept apart). Done: an Open WebUI and a DeepTutor sign-in side by side, each in the Keychain, with DeepTutor's data cached under its own keys. The switch button sits at the top left in both spaces (beside the sidebar button in Open WebUI, beside Back on DeepTutor's inner screens), and Connect DeepTutor is in the account menu. Each space records itself while it shows, and a launch opens straight into the last one (read before the first frame, so Open WebUI doesn't flash first; a launch from a notification goes to its chat). A longer list (several Open WebUI servers) comes with M4's scratch instance |
| [x] | `packages/deeptutor-protocol`, a DeepTutor contract probe (`npm run probe:deeptutor`), and fixtures per version (`tools/contract-probe/fixtures/deeptutor-1.7.1/`). |
| [x] | `.ref/deeptutor` pinned at the deployed tag (`packages/deeptutor-protocol/src/support.json`), and the copy check extended to cover it. |
| [~] | The DeepTutor space: web view plus a native bar (store build 3, `react-native-webview`). Built with react-native-webview 14.0.1: DeepTutor's `/chat` under a slim bar (Switch to Open WebUI; menu: Chats for Open WebUI, Reload, Open in Browser, Sign out). The sign-in comes from iOS's shared cookie store (native requests use `credentials: 'include'`); if the web view still lands on `/login`, it sets the cookie from the stored token once per visit. Links to other sites open in the browser, swipe goes back, and the app now declares the microphone for DeepTutor's voice features. Not yet tried on a phone |
| [x] | "Reference DeepTutor Chat" in the Open WebUI + menu (a `text` attachment, see above). |
| [x] | "Send to DeepTutor" in the Open WebUI chat menu (saved chats only): the shown branch as Markdown, filed as a `chat` record in the "From MavieChat" notebook, with our own summary. |
| [ ] | Phone checks: switch both ways without signing in again; both cross-reference directions; an expired DeepTutor sign-in; offline. |
| [~] | Native DeepTutor chat over the `/ws` turn protocol 2.0 (see "Native chat" and "Modes"). Slice 1 (Chat) and slice 2 (Solve, Quiz, Research, Visualize, Ask Questions) are done. Mastery path, Reading, Audio overview and the animation modes open in the web app. |
