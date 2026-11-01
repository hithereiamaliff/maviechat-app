# MavieChat

MavieChat is a native iPhone app for [Open WebUI](https://github.com/open-webui/open-webui) servers. It follows the web app's own layout:
- the sidebar with folders and date-grouped chats;
- the model selector in the input bar;
- branch arrows and multi-model answers;
- the controls panel, workspace and admin.

It is an independent project and is not affiliated with Open WebUI.

**Status:** milestone M0 (foundations). Sign-in, server capabilities and the live socket work against a real server. See `docs/plan.md`.

## Development

Requires Node 22 or newer.

```bash
npm install
npm run check
```

`npm run check` runs typecheck, lint, unit tests, and the licence and copy checks.

```bash
npm run bundle
```

`npm run bundle` builds the iOS JavaScript bundle.

```bash
npm run probe
```

`npm run probe` is the read-only contract check against your server (see `docs/setup.md`).

To run the app, use `npx expo start` in `apps/mobile`. It needs a development build for native modules.

## Docs

- `docs/plan.md`: the approved plan and milestones.
- `docs/protocol.md`: the Open WebUI protocol as MavieChat uses it.
- `docs/parity.md`: the screen-by-screen checklist against the web app.
- `docs/setup.md`: one-time setup (test account, EAS, TestFlight).
- `AGENTS.md`: rules for coding agents (clean-room, secrets, server access).
