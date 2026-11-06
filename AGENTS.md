# MavieChat: notes for coding agents

MavieChat is a native iPhone app for Open WebUI and DeepTutor servers, and for OpenCode on your own computer. It follows each web app's layout and is built with Expo SDK 58, React Native and TypeScript.

**The maintainer's notes:** on the maintainer's machine, `ops/` holds the private notes: the servers, test accounts, house rules, the plan and the probe catalog. It isn't part of the public repository. When it's there, read `ops/AGENTS.md` before running probes, deploying or touching a server.

Docs:
- `docs/protocol.md` is the protocol spec;
- `docs/parity.md` is the screen-by-screen checklist against the web app;
- `docs/deeptutor.md` has the DeepTutor findings.

## Rules

- **Clean-room.** Open WebUI, Conduit, DeepTutor and OpenCode's web app are specs only.
  - Never copy their code, CSS/Tailwind class lists, icons, images or locale files.
  - Read the pinned checkout `.ref/open-webui` (made by `npm run ref:sync`) for facts: endpoint paths, field and event names, behaviour. Then write our own code.
  - `npm run check:copies` enforces this.
- **Licences.** Nothing the app ships may depend on GPL, AGPL, LGPL or Open WebUI-licensed code. `npm run check:licenses` enforces this.
  - After adding or upgrading a production dependency, run `npm run licenses` to refresh the notices the About screen shows, with each licence's text (`licenses.json` and `license-texts.json` in `apps/mobile/src/generated`).
  - Native libraries compiled into the iOS app aren't npm packages, so they're listed by hand in `scripts/native-licenses/index.json`, with their licence texts beside it. Re-check that list against the podspecs when Expo or React Native is upgraded.
- **Untrusted reference.** Never run, build or install anything inside `.ref/`.
- **Separate product:** its own EAS project, robot token and bundle ID (`digital.techmavie.maviechat`).
- **Secrets** stay out of the repository. Pass them only as environment values; never print them.
- **Expo changes every SDK.**
  - Before touching an Expo, EAS or React Native API, read the SDK 58 docs at `https://docs.expo.dev/versions/v58.0.0/`. Append `.md` to any docs URL; the index is `https://docs.expo.dev/llms.txt`.
  - Install packages with `npx expo install` from `apps/mobile`.
  - See `docs/expo-agent-notes.md`.
  - **Uploads:** the app's `fetch` is Expo's, which refuses React Native's `{ uri, name, type }` FormData parts before sending anything (the app showed "couldn't reach the server"). Send picked files with `uploadPart()` (`apps/mobile/src/lib/uploadPart.ts`), a part that reads its own bytes under the file's own name; it holds the file in memory, so phone uploads stop at 100 MB.

## Layout

- `apps/mobile`: the Expo app (expo-router; routes in `src/app/`).
  - **Accounts (M7):** each space keeps several sign-ins.
    - The Keychain item `maviechat.accounts` lists them with no tokens (`src/session/accounts.ts`); each sign-in sits in `maviechat.account.<id>`.
    - `useSession()` / `useDeepTutor()` return the account in use; their layouts key everything by `state.accountId`.
    - Change the list only through `updateAccountIndex` (one change at a time).
    - The account in use is still mirrored to the old `maviechat.session` / `maviechat.deeptutor.session` keys, so an update rolled back to an older version stays signed in. Drop the mirroring once every phone runs M7.
    - Open WebUI's query keys aren't per account: switching clears every query outside `OTHER_SPACE_ROOTS`. DeepTutor's sit under `dt`.
- `packages/owui-protocol`: the protocol client in plain TypeScript (REST, auth, capabilities, socket).
  - Runs in React Native and in Node.
  - The supported server range is in `src/support.json`.
- `tools/contract-probe`: read-only live check. Fixtures (shapes only) go in `fixtures/<server version>/`.
- `packages/opencode-protocol`: OpenCode through the gateway: the client, pairing links, an SSE reader, and the reducer that turns events into a live session.
- `services/opencode-gateway`: lets the app reach OpenCode on a machine (dependency-free Node 24; see its README).
  - Its README is the public setup guide; `.github/workflows/gateway-image.yml` builds its image, ghcr.io/hithereiamaliff/maviechat-gateway, while the repository is public.
  - Notifications (`watch.ts`): the gateway itself sends them through Expo, for sessions a phone prompted with `x-maviechat-push`. Push tokens stay in memory only. Never log tokens or titles, and never put commands, paths or reply text into a notification.
  - OpenCode's answers can carry secrets: `/config/providers` holds every provider's API key, and `/config` holds MCP servers' keys and headers. `sanitize.ts` cuts those answers down (from `/config` and `PATCH /global/config` only the default model passes, and their errors are replaced), and the event stream passes only the kinds the app uses. `PATCH /global/config` forwards only a checked `model` (`defaultModelPatch`); never widen it, since OpenCode's settings can start MCP commands as root. Before adding a route to `rules.ts`, check its answer for secrets.
- `services/push-relay`: MavieChat's push relay (dependency-free Node 24; see its README).
  - The relay serves only TechMavie Digital's servers. The app never sends another server's sign-in to it: `isRelayServer` in `apps/mobile/src/features/notifications/relay.ts` gates every call.
- `scripts/`: reference sync, copy check and licence check.

## Commands (repo root)

- `npm run check`: typecheck, lint, unit tests, licence check and copy check. Run it before every commit.
- `npm run bundle`: the iOS JavaScript bundle (`expo export`). CI runs it too.
- `npm run probe`, `npm run probe:deeptutor` and `npm run probe:opencode` check the app's protocol code against live servers: Open WebUI, DeepTutor, and OpenCode through the gateway. They read credentials from environment variables, write only to test accounts and scratch instances, and delete what they make. The maintainer's catalogue of probe runs is in `ops/AGENTS.md`.
- `npm run compare -- 0.11.3 0.12.5`: what each recorded endpoint answer gained, lost or retyped between two versions' fixtures. `npm run bench:chat`: a 500-message chat through the chat code, against a frame budget (fails over it).
- `npm run ref:sync`: the pinned reference checkouts, `.ref/open-webui` and `.ref/deeptutor`.
- `npm run icons`: regenerates `apps/mobile/src/components/icons.generated.ts` from Heroicons. Add names in `scripts/gen-icons.mjs`.

## Builds and updates

All EAS commands run from `apps/mobile` with `EXPO_TOKEN=$(cat ~/.config/maviechat/expo-token)`. The maintainer's exact commands are in `ops/setup.md`.

- **Store build:** `eas build -p ios --profile production --auto-submit --non-interactive --no-wait`.
  - Unattended, because `ascAppId` is pinned in `eas.json`.
  - Builds cost EAS quota and land in TestFlight, so start one only when there is something to test.
- **Over-the-air update:** `eas update --channel production --platform ios --environment production --non-interactive`. It is for JavaScript-only changes.
- **Runtime version policy: `fingerprint`.** A native change (new native module, plugin or permission) needs a new store build. Updates never reach builds with a different fingerprint.
- **After `eas init` / `eas update:configure`:** strip the plugin-evaluated values they write into `app.json` (e.g. `extra.router`).
- **App icon:** `python3 scripts/app-icon/render.py` (needs numpy and Pillow) draws it from the shapes in `scripts/app-icon/icon.json` into `apps/mobile/assets`: the iOS icon, Android's adaptive layers and the favicon. To change the icon, edit the JSON and run it again. A new icon needs a store build.

## Server versions

- Supported: 0.11.3 (production).
- Bump `maxValidated` in `packages/owui-protocol/src/support.json` only after the probe passes against that version on a scratch instance.
- Bump `referenceTag` at the same time and re-run `npm run ref:sync`.
