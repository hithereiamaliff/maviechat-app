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

## M1.5 checklist

| | Item |
|---|---|
| [~] | Spike: native sign-in (cookie store or Bearer); a web view reusing the sign-in; `GET /api/sessions` and a notebook record written from the app. Done from Node: Bearer sign-in, sessions, notebook record. The web view and the phone's cookie store wait for store build 3 |
| [~] | Saved servers and a switcher (Keychain per server; caches kept apart). Done: an Open WebUI and a DeepTutor sign-in side by side, each in the Keychain, with DeepTutor's data cached under its own keys. Switch to (or Connect) DeepTutor sits in the account menu, Switch to Open WebUI in the DeepTutor bar, and a launch returns to the space used last. A longer list (several Open WebUI servers) comes with M4's scratch instance |
| [x] | `packages/deeptutor-protocol`, a DeepTutor contract probe (`npm run probe:deeptutor`), and fixtures per version (`tools/contract-probe/fixtures/deeptutor-1.7.1/`). |
| [x] | `.ref/deeptutor` pinned at the deployed tag (`packages/deeptutor-protocol/src/support.json`), and the copy check extended to cover it. |
| [~] | The DeepTutor space: web view plus a native bar (store build 3, `react-native-webview`). Until then: your DeepTutor chats in a native list (search, read-only view, "Ask about it in Open WebUI"), and Open DeepTutor in the browser |
| [x] | "Reference DeepTutor Chat" in the Open WebUI + menu (a `text` attachment, see above). |
| [x] | "Send to DeepTutor" in the Open WebUI chat menu (saved chats only): the shown branch as Markdown, filed as a `chat` record in the "From MavieChat" notebook, with our own summary. |
| [ ] | Phone checks: switch both ways without signing in again; both cross-reference directions; an expired DeepTutor sign-in; offline. |
| [ ] | Later, decided after use: native DeepTutor chat over the `/ws` turn protocol 2.0. |
