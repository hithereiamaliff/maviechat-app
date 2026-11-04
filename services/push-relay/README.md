# MavieChat push relay

Turns Open WebUI's "chat finished" and "chat failed" events into push notifications on users' phones, through Expo's push service. It works for every Open WebUI account: it uses the server-wide event webhook, not per-user webhooks, which Open WebUI only allows for admins and accounts with the "User Webhooks" permission.

- **`POST /v1/devices`**, **`DELETE /v1/devices`**: the app adds or removes `{pushToken}`.
  - It sends `Authorization: Bearer <Open WebUI token>`. The relay checks it with `OWUI_URL/api/v1/auths/` and files the phone under that user's id.
  - A phone can belong to several accounts at once (the app's account switcher), up to 10, with up to 10 phones per account.
- **`POST /v1/devices/test`**: a test notification to the caller's phone.
- **`POST /v1/events/<EVENTS_SECRET>`**: Open WebUI's server-wide webhook.
  - Set it up once in Open WebUI's Settings window: Admin → System → General → Events → Webhooks → **+**, for events `chat.finished` and `chat.failed`, sent for all users.
  - For each event the relay notifies that user's phones with "Reply ready: <chat title>" and the start of the reply. The notification carries the user id, so the app opens it in the right account.
  - Phones Apple reports as gone are dropped.
- **`POST /v1/deeptutor/watch`**: notify a phone when a DeepTutor turn ends or asks a question. DeepTutor has no hook of its own.
  - The app sends `Authorization: Bearer <DeepTutor token>` and `{pushToken, sessionId, turnId, title, server}`.
  - `server` must be `DT_PUBLIC_URL`. The relay checks the token with `DT_URL/api/auth/status`, then follows the turn over `DT_URL/ws` (inside the server) with the same `Cookie` header as the app.
  - It sends "DeepTutor has a question" (once), then "DeepTutor reply ready" with the start of the answer, or the mode's result in a line (quiz, research plan, visualization). It sends "couldn't finish" on failure and nothing when you stop a reply.
  - The token stays in memory for that watch only (3 hours at most) and is never logged or stored.
  - At most 200 watches at once and 10 per phone. A restart forgets them.
- **`GET /health`**.

**Which servers:** only `OWUI_URL`'s and `DT_PUBLIC_URL`'s users. The app calls the relay only when it's signed in to one of those (`isRelayServer` in the app), so other servers' sign-ins never reach it.

**Stored:** `DATA_DIR/devices.json` (mode 600) holds Open WebUI user ids, push tokens and when the last event arrived. No passwords, Open WebUI tokens or chat text.

**Environment:**
- `EVENTS_SECRET`: at least 32 URL-safe characters; it is part of the webhook address.
- `OWUI_URL`: the one Open WebUI server whose users may register.
- `DATA_DIR`: default `/data`.

