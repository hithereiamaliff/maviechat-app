# MavieChat push relay

Turns Open WebUI's "chat finished" and "chat failed" events into push notifications on users' phones, through Expo's push service. It works for every Open WebUI account: it uses the server-wide event webhook, not per-user webhooks, which Open WebUI only allows for admins and accounts with the "User Webhooks" permission.

- **`POST /v1/devices`**, **`DELETE /v1/devices`**: the app adds or removes `{pushToken}`.
  - It sends `Authorization: Bearer <Open WebUI token>`. The relay checks it with `OWUI_URL/api/v1/auths/` and files the phone under that user's id.
  - A phone belongs to one account at a time, with up to 10 phones per account.
- **`POST /v1/devices/test`**: a test notification to the caller's phone.
- **`POST /v1/events/<EVENTS_SECRET>`**: Open WebUI's server-wide webhook.
  - Set it up once in Open WebUI's Settings window: Admin → System → General → Events → Webhooks → **+**, for events `chat.finished` and `chat.failed`, sent for all users.
  - For each event the relay notifies that user's phones with "Reply ready: <chat title>" and the start of the reply.
  - Phones Apple reports as gone are dropped.
- **`GET /health`**.

**Stored:** `DATA_DIR/devices.json` (mode 600) holds Open WebUI user ids, push tokens and when the last event arrived. No passwords, Open WebUI tokens or chat text.

**Environment:**
- `EVENTS_SECRET`: at least 32 URL-safe characters; it is part of the webhook address.
- `OWUI_URL`: the one Open WebUI server whose users may register.
- `DATA_DIR`: default `/data`.

