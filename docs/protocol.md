# Open WebUI protocol, as MavieChat uses it

This is a spec written from reading Open WebUI's source (v0.12.5, read 2026-11-01). Items marked **0.11.3 ✓** were also checked against the v0.11.3 tag, the version our server runs. Paths are relative to the open-webui repository.

- **Clean-room:** this file records facts (paths, field names, event names, behaviour). It never copies Open WebUI code.
- **Probe before relying on a claim:** `tools/contract-probe` checks it against the live server. Mark what the probe confirms.

## 1. Auth and session

**Sign in.** `POST /api/v1/auths/signin {email, password}` returns one of:
- a session: `{token, token_type: "Bearer", expires_at, id, email, name, role, profile_image_url, permissions}`;
- `{next_step: "pending"}`: the account waits for admin approval;
- an MFA challenge `{next_step: "enroll"|"verify"|"recover", challenge_token, expires_in}` (0.12.x). It is finished with `POST /api/v1/auths/mfa/{verify|enroll/start|enroll/confirm|recover}`.
- Source: `backend/open_webui/models/auths.py`.

**Other sign-in routes**
- LDAP: `POST /api/v1/auths/ldap {user, password}`, only when `features.enable_ldap`.
- Sign-up: `POST /api/v1/auths/signup`. MavieChat has no sign-up screen.
- Signout: `POST /api/v1/auths/signout`. It may return `{redirect_url}` (OIDC end-session).
- Current session: `GET /api/v1/auths/` returns the user, `permissions` and `expires_at`.

**Token**
- HS256 JWT with claims `{id, typ: "session", auth_method, auth_time, session_stamp, mfa_verified, jti, iat, exp}`.
- Lifetime is `JWT_EXPIRES_IN` (default `4w`; `-1` means it never expires).
- **There is no refresh endpoint.** The app tracks `expires_at` and asks the user to sign in again.
- Revocation: a password change or "sign out all devices" changes `session_stamp`; signout revokes the `jti` (in Redis); an admin can revoke all of a user's sessions.

**How the web app keeps the token**
- It stores it in `localStorage.token` and sends `Authorization: Bearer <jwt>`. Login also sets an httponly `token` cookie.
- It re-checks `GET /api/v1/auths/` every 15 s, on focus, and after any 401, and signs out 60 s before expiry (`src/routes/+layout.svelte`).

**OAuth/OIDC** (not used by our server today)
- Flow: `/oauth/{provider}/login` → identity provider → `/oauth/{provider}/login/callback` → 302 to `{WEBUI_URL}/auth`.
- The token arrives as a non-httponly `token` cookie, not in the URL.
- Native token exchange: `POST /api/v1/auths/oauth/{provider}/token/exchange {token}`. It only works when `ENABLE_OAUTH_TOKEN_EXCHANGE` is on and the user already exists.

**Trusted header:** `WEBUI_AUTH_TRUSTED_EMAIL_HEADER`. When `features.auth_trusted_header` is set, the web app auto-posts signin.

**API keys (`sk-…`)**
- Managed with `POST|GET|DELETE /api/v1/auths/api_key`.
- They need `ENABLE_API_KEYS`, and non-admins also need the `features.api_keys` permission.
- Accepted as Bearer, the `token` cookie or the `x-api-key` header on most REST routes.
- **Not accepted by Socket.IO** (connect or `user-join`), `/api/v1/audio/realtime` or `GET /api/v1/auths/`. MavieChat therefore uses the JWT session.

## 2. Config and capability gating

- `GET /api/version` returns `{version, deployment_id}`. Our server answers `0.11.3`.
- **`GET /api/config`, anonymous:** `status, name, version, default_locale, oauth{providers}`, plus `features{auth, auth_trusted_header, enable_ldap, enable_signup, enable_login_form, enable_websocket, enable_signup_password_confirmation, …}`.
- **`GET /api/config`, signed in, adds:**
  - about 45 `features.enable_*` flags (web_search, image_generation, code_interpreter, folders, channels, notes, memories, direct_connections, tool_servers, title/tags/follow_up/autocomplete generation, user_webhooks, …);
  - `default_models`, `default_prompt_suggestions`;
  - `code{engine, interpreter_engine}`;
  - `audio{tts{engine, voice, split_on}, stt{engine}, realtime{…}}`;
  - `file{max_size, max_count, image_compression}`;
  - `permissions` defaults and `ui{…}`, including `ui.visibility`.
- **Gating rule** (the web uses it everywhere): a control shows only if the feature flag is on, the user is an admin or holds the permission, and the control is not hidden.
  - Formally: `config.features.enable_X && (role === "admin" || user.permissions.features.X) && !hidden(config.ui.visibility, id)`.
  - The visibility list has about 70 control IDs, e.g. `chat.archive`, `chat.fork`, `models.set_default` (`src/lib/utils/ui-visibility.ts`).
- On socket connect the web app re-reads `/api/version` and reloads if `version` or `deployment_id` changed. MavieChat instead clears its caches and rebuilds its capabilities.

## 3. REST endpoints a chat client needs

**Core**
- `POST /api/chat/completions`
- `GET /api/models` returns `{data: [...]}`; each entry is a "model item" and is sent back as `model_item`.
- `GET /api/v1/models/model/profile/image?id=` (bearer token) answers with the model's picture, or redirects to a linked image or to the server's `/static/favicon.png`. `/api/models` leaves `profile_image_url` out.
- `GET /api/tasks/chat/{chat_id}` returns `{task_ids}`.
- `POST /api/tasks/chat/{chat_id}/stop`
- `POST /api/chat/actions/{action_id}`

**Chats** (`/api/v1/chats`)
- Listing and search:
  - `GET /?page=&include_pinned=&include_folders=` (60 per page);
  - `GET /pinned`, `GET /search?text=&page=`, `GET /folder/{id}/list`, `GET /all/tags`.
- Create, read, update, delete:
  - `POST /new` (special actions only; see §5);
  - `GET|POST|DELETE /{id}` (`POST` takes `{chat: {partial}}` and merges);
  - `PATCH /{id}/params`.
- Single messages:
  - `POST|DELETE /{id}/messages/{mid}`;
  - `POST /{id}/messages/{mid}/resolve` (approvals and questions; §7).
- Chat actions: `POST /{id}/fork {message_id}`, `/compact {model}`, `/pin`, `/archive`, `/share`, `/folder {folder_id}`, `/clone`, `/unread`, `POST /read`.
- Tags: `GET|POST|DELETE /{id}/tags`.
- Import: `POST /import`.

**Folders:** `GET|POST /api/v1/folders/`, `/{id}`, `/{id}/update`, `/{id}/update/parent`, `/{id}/read`, `DELETE /{id}`.

**Files**
- Upload: `POST /api/v1/files/?process=` with multipart `file` plus `metadata` JSON. Images use `process=false`.
- Processing progress: `GET /files/{id}/process/status?stream=true` (SSE).
- `GET /files/{id}`, `GET /files/{id}/content`, `DELETE /files/{id}`.

**Knowledge:** `/api/v1/knowledge/` (list and search), `/{id}`, `/{id}/file/{add|remove}`.

**Prompts, tools, skills, functions and models**
- `GET /api/v1/prompts/list`
- `GET /api/v1/tools/`, with user valves at `/tools/id/{id}/valves/user[/update]`
- `GET /api/v1/skills/`
- `GET /api/v1/functions/`
- Workspace models: `/api/v1/models/*`

**User settings and info**
- `GET /api/v1/users/user/settings` returns `{ui: {...}}`.
- `POST /api/v1/users/user/settings/update {ui: {...}}`. Read, change and write back, keeping unknown keys.
- `/users/user/info[/update]`, `/users/user/status/update`, `/users/user/variables[/update]`.

**Memories:** `GET /api/v1/memories/`, `/add`, `/{id}/update`, `/query`, `DELETE /{id}`.

**Audio:** `POST /api/v1/audio/transcriptions` (multipart `file`, `language`), `POST /api/v1/audio/speech {input, voice, model?}` (returns audio bytes), and `GET /voices`, `/models`, `/config`.

**Images:** `POST /api/v1/images/generations`, `/edit`; `GET /models`.

**Retrieval:** `POST /api/v1/retrieval/process/url`, `/process/web/search`, `/process/youtube`.

**Tasks:** `POST /api/v1/tasks/{title|tags|follow_up|queries|auto|emoji|image_prompt|moa}/completions`.

**Feedback:** `POST /api/v1/evaluations/feedback`, `POST|GET|DELETE /feedback/{id}`.

**Code:** `POST /api/v1/utils/code/execute` (the server's Jupyter engine).

**Notifications** (0.11.3 ✓ the module exists)
- `/api/v1/notifications/{events,targets,targets/{id}[/default|/test]}`.
- Webhook deliveries for `chat.finished`, `chat.failed` and others fire while the user is away.

## 4. Chat data model

**Chat row:** `{id, title, models, history{messages{id: msg}, currentId}, messages[], files, tags, params, folder_id, timestamp(ms), …}`. The stored `current_message_id` wins over `history.currentId` on load.

**User message**
- Fields: `{id, parentId, childrenIds: [], role: "user", user{id,name}, user_id, content, files?, timestamp (unix s), models: [selected model ids]}`.
- When the parent user message has more than one entry in `models`, the UI shows multi-model columns.

**Assistant message**
- Fields: `{id, parentId, childrenIds: [], role: "assistant", user_id, content, done, model, modelName, modelIdx, timestamp}`.
- Filled in later:
  - `output[]`: OpenResponses-style items of type `message`, `reasoning`, `function_call`, `function_call_output`, `open_webui:code_interpreter`, `open_webui:context_compaction`, `image_generation_call`, …;
  - `content`: derived from the `message` items;
  - `usage`, `error{content}`, `statusHistory[]`, `sources[]`, `files[]`, `embeds[]`, `followUps[]`;
  - `meta{task_id, response_started_at, response_ended_at}`.
- Written by the client: `annotation{rating, reason, comment, tags, details}`, `feedbackId`, `favorite`, `merged`.

**Confirmed by the 0.11.3 probe** (fixtures in `tools/contract-probe/fixtures/0.11.3/`):
- Assistant messages carry `meta.variables`: the template variables resolved for that turn, such as `{{USER_NAME}}`, `{{CURRENT_DATE}}`, `{{USER_LOCATION}}`.
- `output[]` items seen so far: `message`, `reasoning`, `function_call` and `function_call_output`, from a turn where the model used a tool.
- Saved-chat keys:
  - top level: `archived, chat, context_usage, created_at, current_message_id, folder_id, id, meta, pinned, share_id, summary, tasks, title, updated_at, user_id, variables`;
  - `chat.*`: `files, history, id, messages, models, tags, timestamp, title`.

**Tree rules**
- Siblings share a `parentId` and appear in the parent's `childrenIds`.
- Branch arrows walk the siblings.
- `currentId` is the displayed leaf.
- The server rebuilds `childrenIds` from `parentId` when merging saves.

**Multi-model:** responses are grouped by `modelIdx`, falling back to `model` for old chats without `modelIdx`.

## 5. Sending a turn (0.11.3 ✓ same flow)

There is one `POST /api/chat/completions`. The web client builds the payload in `Chat.svelte`:
```
stream, model (first model), messages: [system only for saved chats — the server loads the rest],
params, files, filter_ids, tool_ids, skill_ids, terminal_id, tool_servers, features{web_search,
image_generation, code_interpreter, voice, memory}, variables, model_item, session_id (socket id),
chat_id, folder_id, id (first assistant id), message_ids: [{model_id, message_id, modelIdx}],
parent_id (user message's parentId ?? null), user_message (full object),
regeneration_prompt?, regeneration_message_id?, assistant_message_id? (continue),
background_tasks{title_generation, tags_generation (first turn only), follow_up_generation}
```
The response is `{status: true, task_ids: [...], chat_id}`.

**New chat**
- Send `parent_id: null` and no `chat_id`.
- The server creates the chat, emits `chat:list`, and starts title generation (`backend/open_webui/main.py`, `is_new_chat`; 0.11.3 ✓).
- The client adopts the returned `chat_id`.
- The web client only calls `POST /api/v1/chats/new` itself for special actions (`createMessagePair`, `addMessages` in 0.11.3; also saving a temporary chat).

**Existing chat:** the server appends the user message and one placeholder per model, emits `chat:messages` (0.12.x), and updates `models`/`files`/`variables`.

**Regenerate and continue**
- Regenerate reuses the user message (`regeneration_message_id`).
- Continue sends `assistant_message_id` and creates no new turn.

**Fan-out:** one server task per `message_ids` entry. Only the first runs title and tags generation.

**Temporary chats**
- `chat_id: "temporary:<socket id>"`. The client sends the full `messages`; nothing is persisted.
- "Save chat" later uses `POST /chats/new`.

**Disconnects**
- With `session_id` and `chat_id`, generation runs on even if the app leaves.
- In-progress output lives in a snapshot (Redis or memory) and is **overlaid on `GET /api/v1/chats/{id}` with `done: false`** (`overlay_response_streams`, 0.11.3 ✓).
- Stop with `POST /api/tasks/chat/{id}/stop`. This persists `done` and emits `chat:tasks:cancel`.

**What the client still writes:** `POST /api/v1/chats/{id} {chat: {partial}}`, for:
- edits without resubmitting;
- ratings;
- branch switches (`history.currentId`);
- renames;
- controls autosave.

The server merges these writes: it keeps its own copy of in-progress assistant messages, and the union of messages wins. **Never write a full history while a reply streams; refetch before saving.**

**Chat controls (0.11.3 ✓, `npm run probe -- --a3`)**
- A chat's own system prompt and parameters live in `chat.params` (`system`, `temperature`, `stop`, …; the web stores `null` for a parameter set back to Default). The Controls panel saves them with `POST /api/v1/chats/{id} {chat: {params, files}}`, 400 ms after the last change. The server patches only the keys sent, so this is safe while a reply streams.
- The request carries `params: {...user settings params, ...chat params}` (nulls mean unset) with `stop` as a list (the web stores a comma-separated string and reads escapes such as `\n`), and `messages: [{role: 'system', content}]` when the chat or the user has a system prompt.
- `stream` comes from the model's `info.params.stream_response`, then the user's, then the chat's; default true. With `stream: false` the reply still arrives over the socket (`chat:completion` with the whole text) and is saved the same way.
- **A new chat's params aren't saved by the request**: the web saves them with the update call once the chat exists. The app does the same.
- **Files:** the server stores the request's `files` as the chat's `files` on creation (`files or []`) and on every later turn that sends `files`. The web sends the chat's files that are still in the shown conversation, plus the new message's documents. So a document removed in Controls stays out. Photos travel in `user_message.files` instead.
- **Valves:** `GET /api/v1/tools/` and `GET /api/v1/functions/` (any signed-in user) list them; `GET /api/v1/{tools|functions}/id/{id}/valves/user/spec` gives the JSON schema (null without `UserValves`); `GET …/valves/user` your values; `POST …/valves/user/update` saves (the server drops nulls, validates, answers with what it kept). Options may be strings or `{value, label}`.
- **Overview** is the web's graph of `history.messages`; tapping a message follows its newest children to a leaf and shows that branch (saved as `currentId`).
- Permissions (all default to allowed; admins always): `chat.controls` (the Controls tab), `chat.valves`, `chat.system_prompt`, `chat.params`. Some parameters are admin-only on the web: stream chunk size, compaction threshold, `use_mmap`, `use_mlock`, `num_thread`, `num_gpu`, custom params.

## 6. Socket.IO

**Connection**
- socket.io-client 4.x against python-socketio 5, path `/ws/socket.io`.
- Use transports `["websocket"]` when `features.enable_websocket` (true on our server); otherwise polling then websocket.
- Handshake `auth: {token: <jwt>}`. The server joins room `user:{id}` and re-validates the token every 30 s.
- An unauthenticated socket still connects but receives nothing, so check identity with `user-join`.

**Client → server**
- `user-join {auth: {token}}`: acks `{id, name}`. Compare with `/api/v1/auths/`.
- `heartbeat {}` every `features.websocket_heartbeat_interval` (default 30 s). It drives presence.
- `usage {action: "chat", model, chat_id}`.
- `events:chat {chat_id, data: {type: "join"|"leave"|"typing"|"last_read_at"}}`.

**Server → client envelope:** event `events` carrying `{chat_id, message_id, data: {type, data}}`.

**Event types and what the app does**
- `response:completion`: OpenResponses stream events (`response.output_item.added/done`, `response.output_text.delta`, `response.reasoning_text.delta`, `response.function_call_arguments.delta`, `response.content_part.*`, `response.completed`). Apply them to `output[]` (the web's reducer is `src/lib/components/chat/Messages/structuredOutput.ts`; ours is a clean-room equivalent).
- `chat:completion`: `{output | choices | content, sources, usage, error, selected_model_id, done, title}`. A full `output` replaces ours; `done` ends the turn.
- `chat:message:delta` / `message`: append to `content`.
- `chat:message` / `replace`: set `content`.
- `status`: append to `statusHistory`.
- `source` / `citation`: append to `sources`, or upsert `code_executions` when `data.type === "code_execution"`.
- Message extras: `chat:message:files` / `files`, `chat:message:embeds` / `embeds`, `chat:message:follow_ups`, `chat:message:error`, `chat:message:favorite`.
- Chat-level updates: `chat:title` (data is a string), `chat:tags`, `chat:list` (sidebar refresh), `chat:active`, `chat:tasks:cancel`, `chat:outlet`, `chat:reload`.
- `notification {type, content}`: show a toast.
- `access:updated` (a separate socket event): reload permissions, models and tools.

**Events that wait for an ack** (the server uses `sio.call`)
- Shown as cards:
  - `confirmation` → bool;
  - `input` → value or `false`;
  - `request:user_input` → `{status, answers}`;
  - `request:elicitation` → `{action: accept|decline|cancel, content?}`.
- **Answered "unsupported" immediately** so the turn never hangs:
  - `execute` (run JavaScript) and `execute:python` (Pyodide in the client);
  - `request:chat:completion` (direct connections run by the client);
  - `request:terminal`.
- `execute:tool` (call a user tool server from the client): later, with plain fetch.
- Prefer the saved path for approvals and questions: a `function_call` item with `status: "pending"` is answered with `POST /api/v1/chats/{id}/messages/{mid}/resolve {call_id, action: "approve"|"reject"|"answer", answers?}`. It survives the app being suspended.

## 7. Tasks and extras

- **Title, tags, follow-ups:** the server runs them when `background_tasks` asks and the admin flags allow. Results arrive as `chat:title`, `chat:tags` and `chat:message:follow_ups`.
- **Speech-to-text:** engine `"web"` means the browser's own recognition (we use iOS on-device instead). Otherwise `POST /api/v1/audio/transcriptions`.
- **Text-to-speech:** engine `""` means the browser (we use iOS AVSpeech). Otherwise `POST /api/v1/audio/speech`. Voice priority: the model's `info.meta.tts.voice`, then user settings, then config.
- **Code:** "Run" on a code block uses `POST /api/v1/utils/code/execute` when `code.engine === "jupyter"`. The code interpreter with `interpreter_engine: "pyodide"` sends `execute:python` to the client (unsupported in the app); suggest Jupyter on the server.
- **Web search and image generation:** `features.*` flags. With native function calling they are built-in tools.
- **Direct connections and user tool servers:** executed by the browser in the web app. Out of scope until M5 or later.

## 8. Verified by the 0.11.3 write probe (`npm run probe -- --write`, test account)

- **Sidebar lists:** `GET /api/v1/chats/?page=N` returns 60 per page, newest first, **excluding pinned chats and chats in folders** (they have their own lists: `/chats/pinned`, `/chats/folder/{id}/list`).
  - Rows are `{id, title, updated_at, created_at, last_read_at, snippet, active}`; `active` means a reply is generating.
- **Rename:** `POST /api/v1/chats/{id} {chat: {title}}` patches only top-level keys. History intact ✓.
- **Switch branch:** `POST /api/v1/chats/{id} {chat: {history: {messages: {}, currentId}}}` makes the server merge histories.
  - The incoming `currentId` wins only if that message exists.
  - Verified ✓: the shown branch is saved, and every message and branch is kept.
- **Pin / archive:** `POST /api/v1/chats/{id}/pin` and `/archive` toggle and answer with the updated chat ✓.
- **Delete:** needs the `chat.delete` permission. Without it the server answers **401** "You do not have permission…", so the app hides Delete when the permission is off, as the web does.
- **A 401 is not always an expired session.** Open WebUI also uses 401 for "not permitted". After a 401 the app re-checks `GET /api/v1/auths/` and signs out only if that fails too (the web app does the same).
- **Folder open/closed state** is stored on the server: `POST /api/v1/folders/{id}/update/expanded {is_expanded}`.
- **Send** (send probe ✓, `tools/contract-probe/src/send-probe.ts`):
  - A new chat is `POST /api/chat/completions` without `chat_id`.
  - The server creates the chat and answers `{status: true, task_ids, chat_id}` at once; the reply then streams to `session_id`.
  - A one-word reply produced `chat:active`, `response:completion` ×2, `chat:completion` ×3, `chat:outlet`, `chat:list` and `chat:title`.
  - Replaying those events through `applyMessageEvent` gave **exactly** the saved message (text and `output[]`).
- **`messages`** for saved chats holds only the system prompt (0.11.3 web ✓); the server loads the conversation from `parent_id` and `user_message`.
- **No client save after a reply.** In 0.11.3 the web client only refreshes the sidebar after a reply; the server persists output and runs outlet filters. `chat:outlet` patches message text (the app keeps `originalContent`).
- **Answers the app gives to device-execution requests** (so turns never hang):
  - `execute:python` → `{stdout: '', stderr: …, result: null}`;
  - `execute`, `execute:tool`, `request:chat:completion`, `request:terminal` → `{error}`;
  - `request:user_input` → `{status: 'cancelled', answers: {}}`;
  - `request:elicitation` → `{action: 'cancel'}`;
  - `confirmation` and `input` are asked with native alerts.
- **Attachments, regenerate, edit, delete, temporary chats** (slice 3 probe ✓, `tools/contract-probe/src/slice3-probe.ts`):
  - **Upload:** `POST /api/v1/files/?process=true|false`, multipart field `file`, no JSON content type. Documents use `process=true` and are read in the background: poll `GET /api/v1/files/{id}/process/status` until `completed` or `failed` before sending (the web waits the same way, over a stream). Photos use `process=false`.
  - **Attachment item** in `user_message.files`: `{type: 'file', file, id, url: id, name, collection_name, status: 'uploaded', size, error: '', itemId, content_type}`. Photos are told apart by `content_type` and load from `/api/v1/files/{id}/content`.
  - **Request `files`** carry only documents (from the whole shown branch plus the new message, once each); photos travel in `user_message.files`. The model answered from an attached document ✓.
  - **Regenerate:** a new reply placeholder under the same user message (`parent_id` = the user message's parent, `user_message` = that message with the new reply in `childrenIds`); `regeneration_prompt` = "Add Details", "More Concise" or your own words. Two versions afterwards, the new one identical to the server copy ✓.
  - **Edit in place:** `POST /api/v1/chats/{id} {chat: {history: {messages: {[id]: message}, currentId}}}`. Content saved, message count and branches intact ✓. **Edit + Send** is a new user message beside the original (same parent), sent as a normal turn.
  - **Delete message:** `DELETE /api/v1/chats/{id}/messages/{mid}` removes the message and its direct replies, re-attaches grandchildren to its parent, picks the branch to show, and answers with the updated chat ✓. The server checks only ownership: `chat.delete_message` just hides the web's button (own messages: hidden unless granted; reply versions: shown unless denied, and only when another version remains).
  - **Temporary chat:** `chat_id: "temporary:<socket id>"` (the web's own prefix; `local:` is the legacy one), every message in `messages` (finished replies as `{role, model, output}`, photos as `image_url` parts), no title or tags tasks. The reply streams normally and nothing is stored ✓. Attachments stay on the device: photos as `{type: 'image', url: <data URL>}`, text files as `{type: 'text', content}`.
- **Input bar rules** (0.11.3 web): a toggle (web search, image, code interpreter) shows when the server flag, the user permission and the model's `info.meta.capabilities` all allow it (a capability the model doesn't list counts as allowed). A model's `defaultFeatureIds` switch toggles on only for capabilities it lists. Default tools: the model's `toolIds`, else `ui.tools`. Limits: `config.file.max_count`, `config.file.max_size` (MB). Uploads need `chat.file_upload` (allowed unless denied).
- **Read and unread** (slice 4 probe ✓, `tools/contract-probe/src/slice4-probe.ts`):
  - Reading is reported over the socket, not REST: emit `events:chat` `{chat_id, data: {type: 'last_read_at'}}` after `user-join`. The server stamps `last_read_at` and answers with a `chat:list` event (with `folder_unread_counts` when the chat was unread). The web sends it on opening a chat, on leaving it, and when a reply lands while it's open.
  - `POST /api/v1/chats/{id}/unread` sets `last_read_at` to 0.
  - The unread dot (web rule): not the open chat, not while it replies, and `last_read_at` missing/0 or older than `updated_at`. Every sidebar list (`ChatTitleIdResponse`) carries `last_read_at`.
- **Archived chats:** `GET /api/v1/chats/archived?page=&query=` (60 a page, title search) ✓; `POST /api/v1/chats/unarchive/all`; a single chat unarchives with the same toggle as archive.
- **Generate a title:** `POST /api/v1/tasks/title/completions {model, messages: [{role, content}], chat_id}` ✓. The answer is OpenAI-shaped; the content should be `{"title": …}` but may be wrapped in prose or use other quotes. When the admin turned titles off, the server answers 200 with `{detail: "Title generation is disabled"}`.
- **Folder page:** a new chat started there carries `folder_id` in `/api/chat/completions`. Not probed (folders are off for the test account).
- **Message queue** (setting `ui.enableMessageQueue`, default on): messages typed during a reply queue; when the reply ends they go out as one message, texts joined by a blank line and attachments combined. Send now stops the reply and sends one item.
- **New-chat screen and model picker** (slice 5; read-only probe ✓ for the picture):
  - **Model picture:** `GET /api/v1/models/model/profile/image?id=` with the bearer token. The test account's first model redirected to `/static/favicon.png` (no picture set) ✓.
  - **Picker** (0.11.3 web): leaves out models with `info.meta.hidden`; fuzzy search (Fuse.js, threshold 0.4) over id, tag names and name; one filter at a time: Local / External (`connection_type`), Direct (browser-side connections, never in the server's list) or a tag (lower case).
  - **Suggestions:** the model's `info.meta.suggestion_prompts` when it is a list, even an empty one, else `config.default_prompt_suggestions`. They are shuffled each time the list appears and fuzzy-filtered (threshold 0.5, over text and title lines) as you type; none past 500 characters. Tapping sends, unless `ui.insertSuggestionPrompt` is on (then it fills the input).
  - **Author line:** `info.meta.user` → "By {name}"; community models (`community: true`) show `name` or `@username` and link to `https://openwebui.com/m/{username}`.
  - **Pinned sidebar shortcuts:** `ui.pinnedMenuItems` (default `['notes', 'workspace']`, user's order). Notes needs `enable_notes` and `features.notes` (allowed unless denied); Workspace needs admin or any `workspace.*` permission (models, knowledge, prompts, tools, skills); Automations and Calendar need their flag and permission; Playground is admin only.
  - **Markdown extras:** `[^id]` footnote references (shown raised; the web lists no definitions), mentions `<@id|label>`, `<#id|label>`, `<$id|label>` (`@M:` shows the model's name or "Unknown"), and tapping inline code copies it.

## 9. Stability notes

- The web app assumes an exact version match and reloads on change. Six releases shipped between 2026-10-10 and 2026-10-29.
- Many compatibility shims exist: dict-shaped `message_ids`, `parent_message`, `new_chat`, the deprecated `/api/chat/completed`, event aliases, history repair (`sanitizeHistory`), and responses without `modelIdx`.
- No OpenAPI spec in Docker images (`ENV=prod` hides `/docs`), and key endpoints take untyped dicts. Our TypeScript types are hand-written and keep unknown fields.

