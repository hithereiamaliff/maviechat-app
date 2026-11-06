# MavieChat

MavieChat is a native iPhone app for AI you run yourself. It works with three kinds of server:

- **[Open WebUI](https://github.com/open-webui/open-webui)** servers (versions 0.11 and 0.12): chats with any model, files and photos, web search and tools, reasoning, code, maths and diagrams, folders and sharing, the workspace (models, prompts, skills, tools, knowledge) and the admin settings.
- **[DeepTutor](https://github.com/HKUDS/DeepTutor)** servers (version 1.7): problem solving, quizzes and research, knowledge bases, books, readings and videos, a mastery path, a calendar and task board, AI partners and Co-Writer.
- **[OpenCode](https://opencode.ai)** (version 1.19) on your own computer: coding sessions in your project folders, approvals for edits and commands, each file's changes, and notifications when a session finishes or needs you. The computer runs the [MavieChat gateway](services/opencode-gateway/README.md).

Each space can hold several accounts. Replies keep going on the server when you leave the app.

MavieChat is an independent project by TechMavie Digital. It isn't affiliated with or endorsed by Open WebUI, DeepTutor or OpenCode.

**Status:** in TestFlight; the App Store release is being prepared. `docs/plan.md` has the milestones.

## How it's built

MavieChat was written from scratch. Open WebUI, DeepTutor, OpenCode and Conduit were read as specifications only, never copied. Every commit's CI checks that:

- no passage of 50 tokens or more is shared with Open WebUI's or DeepTutor's source;
- no package the app ships is copyleft.

The app shows every licence it ships with, in full, on its About screen.

## Repository

| Folder | What it is |
| --- | --- |
| `apps/mobile` | The iPhone app: Expo SDK 58, React Native, expo-router and TanStack Query. |
| `packages/owui-protocol` | Open WebUI's API and live socket, as MavieChat uses them. |
| `packages/owui-markdown` | Markdown, code, maths and diagrams in replies. |
| `packages/deeptutor-protocol` | DeepTutor's API and live sessions. |
| `packages/opencode-protocol` | OpenCode through the gateway: the client, pairing links, live events. |
| `services/opencode-gateway` | The gateway you run next to OpenCode; its README is the setup guide. |
| `services/push-relay` | Notifications for TechMavie Digital's own servers. |
| `tools/contract-probe` | Live checks of each server's API against what the app expects. |

## Development

Requires Node 22 or newer; the gateway runs on Node 24.

```bash
npm install
npm run check
```

`npm run check` runs the typecheck, lint, unit tests, and the licence and copy checks.

```bash
npm run bundle
```

`npm run bundle` builds the iOS JavaScript bundle. To run the app, use `npx expo start` in `apps/mobile`; it needs a development build for its native modules.

## Docs

- `docs/plan.md`: the plan and milestones.
- `docs/protocol.md`: the Open WebUI protocol as MavieChat uses it.
- `docs/parity.md`: the screen-by-screen checklist against Open WebUI's web app.
- `docs/deeptutor.md`: DeepTutor in MavieChat.
- `docs/setup.md`: one-time setup (test account, EAS, TestFlight).
- `AGENTS.md`: rules for coding agents (clean-room, secrets, server access).

## Security and licence

To report a security problem, see [SECURITY.md](SECURITY.md). MavieChat is released under the licence in [LICENSE](LICENSE).
