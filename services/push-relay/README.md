# MavieChat push relay

Turns Open WebUI's "chat finished" and "chat failed" webhooks into push notifications on the phone, through Expo's push service. It stores nothing.

- `POST /v1/devices`: the app, signed in to Open WebUI (`Authorization: Bearer <Open WebUI token>`), sends `{pushToken}`. The relay checks the token with `OWUI_URL/api/v1/auths/` and answers `{webhookUrl}`. That link carries the push token and user id sealed with AES-256-GCM, so only this relay can read it and nobody can forge one.
- `POST /v1/hooks/<sealed>`: Open WebUI calls the link (a notification target with events `chat.finished` and `chat.failed`). The relay sends "Reply ready: <chat title>" with the start of the reply. It also handles Open WebUI's test button. It answers 410 when the phone no longer accepts notifications.
- `GET /health`.

Environment:
- `RELAY_KEY`: 32 random bytes, base64. Changing it breaks every link, and phones then register again.
- `PUBLIC_URL`: this relay's address.
- `OWUI_URL`: the one Open WebUI server whose users may register.

