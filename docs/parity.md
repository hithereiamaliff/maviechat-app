# Parity checklist: Open WebUI web (phone width) → MavieChat

This inventory comes from reading Open WebUI v0.12.5 (2026-11-01). Component paths are relative to the open-webui repo, under `src/lib/components/` unless they start with `src/`.

It is used as a spec only (clean-room): match the behaviour and layout, never copy the code.

| Mark | Meaning |
|---|---|
| `[ ]` | to do |
| `[~]` | partly done (what's done is named in the row) |
| `[x]` | done |
| `web` | opens Open WebUI in an in-app browser |
| `—` | out of scope |

`Mn` is the milestone in `docs/plan.md`.

**Gating everywhere:** a control shows only if its `config.features.*` flag is on, the user has the permission (admins bypass), and `config.ui.visibility` doesn't hide it. See `docs/protocol.md` §2.

**Phone behaviour in Open WebUI:** "mobile" means narrower than 768 px.
- Sidebar: an overlay over a dark backdrop that opens with a right swipe anywhere except the leftmost 16 px. It commits at about 35% of its width or on a flick, settles in about 210 ms, and closes on any navigation.
- Controls panel: opens with a left swipe in the chat.
- Modals: nearly full screen.
- Menus: anchored popovers.
- Enter: inserts a new line; only the button sends.

## 1. Shell and navigation

| | Item | Source | Mn |
|---|---|---|---|
| [~] | Routes: `/` new chat, `/c/{id}` chat, `/folders/{id}` folder landing, `/s/{id}` shared chat (read-only, Clone). Slice 4: `/folders/{id}` | `src/routes/(app)/…` | M1 (`/s` M2) |
| [ ] | Deep-link parameters: `q`, `models`, `web-search`, `image-generation`, `code-interpreter`, `tools`, `temporary-chat`, `message` | `chat/Chat.svelte` | M2 |
| [x] | Toasts: "Connection lost / Reconnected" (after 2 s, only while the app is open; slice 4), "Session expired" (shown on the sign-in screen; slice 1) | `src/routes/+layout.svelte` | M1 |
| [x] | Swipe-anywhere sidebar overlay; swipe-left controls panel; sideways-scrolling content wins the gesture | `common/MobileSwipePanel.svelte`, `chat/ChatControls.svelte` | M1 / M2 |
| [~] | Pending-approval overlay ("Check Again", Sign Out). The app doesn't sign a pending account in; the sign-in screen says it awaits approval, and signing in again is the "Check Again" | `layout/Overlay/AccountPending.svelte` | M1 |

## 2. Sidebar (`layout/Sidebar.svelte`, `layout/Sidebar/*`)

| | Item | Mn |
|---|---|---|
| [x] | Logo + server name (tap = new chat), New Chat, Search | M1 |
| [x] | Pinned shortcuts under Search, in the user's order (`ui.pinnedMenuItems`, default Notes and Workspace), each only when the account may use it; Playground for admins. Slice 5: they open on the web (Workspace until M3) | M1 |
| [ ] | Section: pinned models (`PinnedModelList.svelte`) opening `/?model=id` | M2 |
| [x] | Section: Folders tree, own and shared. Tap opens the folder landing; the chevron expands; unread badge (folder landing from slice 4) | M1 |
| [ ] | Folder menu: New Chat, Create subfolder, Mark all read, Edit, Export JSON, Delete (optionally with contents) | M2 |
| [ ] | Folder settings: name, description, background, default models, system prompt, knowledge, sharing (`Folders/FolderModal.svelte`) | M2 |
| [x] | Chats: "Pinned" group, then Today / Yesterday / Previous 7 days / Previous 30 days / month / year (from `updated_at`), infinite scroll | M1 |
| [x] | Chat row: generating spinner, unread dot; the "…" button is always visible on phones (no long-press in Open WebUI) | M1 |
| [~] | Chat menu: Share, Download (JSON/TXT/PDF), Rename (+ Generate), Mark unread, Pin, Clone, Move to folder, Archive, Delete (`ChatMenu.svelte`). Slice 1: Rename, Pin, Archive, Delete (only with the `chat.delete` permission); slice 4: Rename + Generate, Mark as unread, Move (needs the folders feature) | M1 (rename/pin/archive/delete/move); M2 (rest) |
| [~] | User menu: avatar and name (→ Account), status emoji/message, Workspace, Admin Panel, Settings, Sign Out (`UserMenu.svelte`). Slice 4: Workspace and Admin Panel (open on the web until M3/M4), Settings, Connection, Sign Out; status and Account → M2 | M1 |
| [~] | Search modal with type/view/location filters, `tag:`, `folder:`, `pinned:`, `shared:`, `archived:`; empty query shows "Pinned & recent" (`layout/SearchModal.svelte`). Slice 1: search field in the sidebar (server search) | M1 basic, M2 filters |
| web | Channels section and channel pages | — |
| web | Notes section and pages | — |

## 3. Chat header (`chat/Navbar.svelte`, `layout/Navbar/Menu.svelte`)

| | Item | Mn |
|---|---|---|
| [x] | Sidebar button, chat title | M1 |
| [~] | "…" menu: Scroll to top, Artifacts, Share, Download JSON/TXT/PDF, Rename, Copy chat, Move to folder, Archive, Delete, Tags editor. Slice 1: Rename, Pin, Archive, Delete; slice 4: Move, and Unarchive on an archived chat | M1 core, M2 rest |
| [~] | Temporary Chat toggle (new chat only) / Save Chat (temporary chat with messages). Slice 3: the toggle, with the `chat.temporary` / `temporary_enforced` rules | M1 toggle, M2 Save Chat |
| [x] | New Chat button (phone only), Controls (knobs) button | M1 |
| [ ] | Admin banners on the new-chat screen | M2 |

## 4. Model selector — lives in the input bar, bottom right (`chat/ModelSelector.svelte`, `ModelSelector/*`)

| | Item | Mn |
|---|---|---|
| [x] | Search by name/ID/tag; filters All / Local / External / Direct / tag. Slice 5: fuzzy search as on the web, filter chips All / Local / External / tags, hidden models left out. Direct connections live in the browser, so the server's list never has them | M1 |
| [x] | Rows: avatar, name, tags, badges, description, checkmark. Slice 5: picture, size label (Ollama, LM Studio, llama.cpp), loaded dot, tag and External icons, description line, default badge, checkmark | M1 |
| [ ] | Row "…": Keep in Sidebar / Hide from Sidebar, Copy link (Edit/Delete for admins → M3) | M2 |
| [ ] | **Compare** toggle for multi-model (permission `multiple_models`) | M2 |
| [x] | "Set as default" (new chat only) | M1 |
| [ ] | Model controls (preset knobs next to the selector) (`MessageInput/ModelControls.svelte`) | M2 |

## 5. Controls panel (`chat/ChatControls.svelte`, `chat/Controls/*`)

| | Item | Mn |
|---|---|---|
| [ ] | Controls tab: chat files, Valves (tool/function user valves), System prompt | M2 |
| [ ] | Advanced params (Default/Custom each): stream, function calling, reasoning tags, seed, stop, temperature, reasoning effort, logit_bias, max_tokens, top_k, top_p, min_p, frequency/presence penalties, mirostat set, repeat_*, tfs_z, Ollama options (think, format, num_ctx, keep_alive, …), custom params (`Settings/Advanced/AdvancedParams.svelte`) | M2 |
| [ ] | Overview tab: graph of the message tree; tap to jump (`chat/Overview/*`) | M5 |
| — | Files tab: terminal file browser / Pyodide file system | — |

## 6. New-chat placeholder (`chat/Placeholder.svelte`, `chat/Suggestions.svelte`)

| | Item | Mn |
|---|---|---|
| [x] | Centred input; stacked model avatars; model name or "Hello, {name}"; description; "By author". Slice 5: the model's picture and name (or "Hello, {name}"), two lines of description (tap for the rest), "By author" (community authors link to their page), input asking "How can I help you today?". One picture until Compare (M2) | M1 |
| [x] | "Suggested" prompts (model's own, else admin defaults), shuffled and filtered as you type; tap sends, or inserts if that setting is on. Slice 5: all of it (a model whose own list is empty shows none; nothing past 500 typed characters). When there are none the web shows its own name and version; the app leaves that line out | M1 |
| [ ] | Landing mode "chat" (input pinned to the bottom) | M2 |
| [ ] | Folder landing page: folder header, input, Chats / Knowledge tabs | M2 |

## 7. Message input (`chat/MessageInput.svelte`, `chat/MessageInput/*`)

| | Item | Mn |
|---|---|---|
| [x] | Above the input: scroll-to-bottom arrow, queued messages (Send now / Edit / Delete) | M1 |
| [ ] | Ask-user cards (multiple choice, "Recommended", Other, Previous/Next, Submit, timeout) (`chat/AskUserCard.svelte`) | M2 |
| [~] | Attachments: thumbnails (warning if the model lacks vision), file chips with spinner and ×; file preview with "Focused Retrieval / Entire Document". Slice 3: all but the preview; server image-compression limits not applied (needs a native resizer) | M1; preview M2 |
| [x] | Expand to a full-screen editor after 2 lines. Slice 5: the button appears from the third line and opens the "Input" editor | M1 |
| [~] | "+" menu: Upload files, Camera, Attach webpage, Attach previous files, Attach knowledge, Reference chats. Slice 3: Upload Files, Photo Library, Capture | M1 (upload, camera, photos); M2 (rest) |
| — | "+" menu: Google Drive / OneDrive, Compare text, Screen capture | — |
| [~] | Integrations menu: tools (switch each; OAuth Connect), skills, filters, Web Search, Image, Code Interpreter. Slice 3: a sheet with Web Search / Image / Code Interpreter (server, permission and model must allow) and tools; model defaults applied | M1 (web search/image/code + tools); M2 (skills/filters/OAuth) |
| [~] | Active chips (tap to turn off); Chat Variables `{}`; model knobs. Slice 3: chips (icon only, as on narrow web layouts) | M1 chips, M2 rest |
| [~] | Last button: Stop (generating, empty input) / Dictate + Voice (empty) / Send. Slice 2: Send and Stop; slice 3: Stop + Queue while typing during a reply | M1 (stop/send); M2 (dictate) |
| [ ] | `/` commands + saved prompts with variables form (`InputVariablesModal.svelte`); `@` models/knowledge/files/URL; `#` folders/collections/files/URLs; `$` skills | M2 |
| [ ] | Built-in variables `{{USER_NAME}}`, `{{CURRENT_DATE}}`, `{{CLIPBOARD}}`, `{{USER_LOCATION}}`, … | M2 |
| [~] | Message queue while replying (setting "Enable Message Queue", default on); queue while uploads finish. Slice 3: the queue (combined with blank lines when the reply ends; off = stop then send); Send waits for uploads instead of queueing | M1 |
| [ ] | Paste image/file uploads it; long paste becomes a `.txt` attachment (setting) | M2 |
| [x] | Drafts kept per chat (text, attachments, toggles, tools, queue; while the app runs) | M1 |
| web | Voice call mode (`CallOverlay.svelte`), realtime voice | — |

## 8. Messages

**List** (`chat/Messages.svelte`): loads older messages when scrolled to the top, auto-follows new output, shows a scroll-down arrow — M1.

**User message** (`Messages/UserMessage.svelte`)

| | Item | Mn |
|---|---|---|
| [x] | Right-side bubble (or flat row setting); attachments; full-screen image viewer | M1 |
| [~] | Edit (Cancel / Save / Send = new branch), Copy, Delete (permission), branch arrows `< n/m >`. Slice 1: Copy, branch arrows; slice 3: Edit (text only; removing files while editing → M2), Delete | M1 |

**Assistant message** (`Messages/ResponseMessage.svelte`)

| | Item | Mn |
|---|---|---|
| [x] | Header: model name (avatar hidden on narrow screens), "context compacted" label | M1 |
| [x] | Status history (latest, expandable; "Searched N sites", "Retrieved N sources") (`ResponseMessage/StatusHistory*`) | M1 |
| [~] | Markdown: GFM, tables (+ Copy / Export CSV), task lists, callouts NOTE/TIP/IMPORTANT/WARNING/CAUTION, footnotes, `[1]` citation chips, mentions, `:::` fences, inline code copy. Slice 1: GFM, tables, task lists, citation chips, math as text; slice 5: footnote references (raised), mentions (`@M:` names the model), tap inline code to copy | M1 core, M2 tables export/callouts/fences |
| [ ] | Math (KaTeX-equivalent, inline and block) | M2 |
| [~] | Code blocks: language label, collapse/expand, Copy, Run (server Jupyter), Preview (HTML/SVG → artifacts), diff blocks; Mermaid and Vega diagrams. Slice 1: label, highlighting, collapse, Copy | M1 copy/collapse; M2 run/preview/diagrams |
| [x] | Collapsibles: Reasoning ("Thinking…", "Thought for N seconds"), code interpreter ("Analyzing…/Analyzed"), tool calls ("Executing X…", "View Result from X", input/output, Allow/Deny), grouped "Explored…" | M1 |
| [x] | Sources: "N Sources" pill with favicons, expandable list, detail sheet (excerpts, relevance, page, open) | M1 |
| [~] | Generated images and files; tool HTML embeds (sandboxed). Slice 3: generated images | M1 images, M2 embeds |
| [x] | Error box; blinking cursor while streaming | M1 |
| [~] | Action bar (always on the last message; tap to reveal on others): branch arrows, Edit (Save / Save As Copy), Copy, Read Aloud, Info (usage), Fork, 👍/👎, Continue (last only), Regenerate menu (Suggest a change / Try again / Add details / More concise), custom actions, Delete (when siblings exist), timestamp. Slice 1: arrows, Copy, Info; slice 3: Regenerate menu, Delete | M1 (arrows, copy, regenerate, info, delete); M2 (edit, read aloud, fork, rate, continue, actions) |
| [x] | Follow-ups list under the last reply (tap sends, or inserts per setting) | M1 |
| [ ] | Rating panel: 1–10, reason chips (up/down sets), comment, Save (`Messages/RateComment.svelte`) | M2 |
| [ ] | Multi-model: full-width swipeable cards; solid border = the branch continued from; per-model arrows; tabs setting; "Merge Responses" | M2 |
| [ ] | Text-selection actions Ask / Explain (`ContentRenderer/FloatingButtons.svelte`) → long-press "Select text" sheet | M2 |

## 9. Chat-level features

| | Item | Mn |
|---|---|---|
| [ ] | Artifacts viewer (combined HTML/CSS/JS, versions, Copy, Download, Full screen) | M2 |
| [ ] | Share (private link; read access to users/groups; mode Clone only / Allow replies; Update and Copy link; delete link) | M2 |
| [ ] | Download JSON / TXT / PDF (plain-text PDF first); Copy whole chat | M2 |
| [x] | Title: live from the server; Rename + Generate. Slice 2: live title and Rename; slice 4: Generate | M1 |
| [ ] | Tags: editor; `tag:` search | M2 |
| [ ] | Clone (sidebar), Fork from a message, `/fork` | M2 |
| [x] | Archive / Unarchive, Pin, Move to folder, Delete, Mark unread; reading a chat clears its dot here and on the web (slice 4) | M1 |
| [~] | Temporary chat (not saved; Save Chat later). Slice 3: temporary chats (photos inline, text files read on the phone; other documents need a saved chat) | M1; Save Chat M2 |
| [~] | Background completions: toast "reply finished" for a chat you're not viewing (tap to open). Slice 2: toast while the app is open | M1 (while foregrounded); M6 push |
| — | Shared-chat presence and typing (Allow replies) | M5 |

## 10. Settings modal (`chat/SettingsModal.svelte`): on phones, a tab strip on top with search behind an icon

| | Tab and contents | Mn |
|---|---|---|
| [~] | General: theme (System/Dark/OLED/Light), language, system prompt, advanced params. Slice 4: theme (kept on the device, as the web keeps it per browser) | M1 theme; M2 rest |
| [ ] | Interface, chat: message queue, landing mode, chat bubbles, show username, widescreen (n/a), temporary chat by default, fade-in streaming, markdown in user messages, auto title/follow-ups/tags, auto-copy, auto-scroll, scroll on branch change, insert prompt instead of send, keep follow-ups, insert follow-up, regenerate menu, always collapse code, always expand details, multi-model as tabs, web search Always | M2 |
| [ ] | Interface, input: rich text (n/a), prompt autocomplete, paste long text as file | M2 |
| [ ] | Interface, file: default upload mode; image compression | M2 |
| [ ] | Notifications: notification webhook targets (events: chat finished / failed) | M6 |
| [ ] | Personalization: Memory switch, Manage memories, Clear all | M2 |
| [ ] | Audio: STT engine (server / on-device), language, auto-send; TTS engine (server / on-device), voice, auto-play, speed | M2 |
| [ ] | Data controls: import/export chats, archive all, delete all, shared chats list, manage files | M2 |
| [~] | Archived chats: search, Unarchive or Delete each, Unarchive all, Export. Slice 4: all but Export | M2 (export) |
| [ ] | Account: photo, name, bio, gender, birth date, user variables, password change, 2FA (0.12.x), API keys, copy session token | M2 (2FA M5) |
| [x] | About: server version, app version, licences (slice 4; the list is `npm run licenses`) | M1 |
| — | Connections (direct connections), Integrations (tool servers/terminals), Keyboard, Usage | — / later |

## 11. Workspace (M3) (`workspace/*`)

| | Item |
|---|---|
| [ ] | Models list: search, sort, enable/hide, import/export JSON, "Try in chat"; menu Edit/Clone/Share/Copy link/Export/Hide/Delete |
| [ ] | Model editor: avatar, name, ID, description, base model, tags, system prompt, params, model controls, suggested prompts, capabilities, default features, built-in tools, knowledge/tools/skills/filters/actions, access, versions |
| [ ] | Knowledge: list, create, collection page with folders, add content (files, webpage, text), file viewer, test query |
| [ ] | Prompts: name, `/command`, content with variables, versions, access |
| [ ] | Skills: import (.skill/ZIP/JSON), edit, files, versions, export |
| [ ] | Tools: create, import from URL, code editor (CodeMirror WebView), valves, history |

## 12. Admin (M4) — the admin tabs live inside the settings modal, as on the web

| | Item |
|---|---|
| [ ] | Users: overview, add/edit, roles, pending approvals; Groups and permissions |
| [ ] | Settings tabs via the form engine, each with a diff before saving: General, Authentication, Interface (banners, visibility), Connections, Models, Sub-agents, Integrations, Apps, Documents, Audio, Images, Web Search, Code Execution, Pipelines, Analytics, Evaluations, Database |
| [ ] | Evaluations: leaderboard, feedback |
| [ ] | Functions: list, create/edit (CodeMirror WebView), valves |

## 13. Auth screens (`src/routes/auth/+page.svelte`)

| | Item | Mn |
|---|---|---|
| [x] | Server URL, then email + password; errors; pending approval (M0, `app/login.tsx`) | M0/M1 |
| [ ] | LDAP switch (when enabled) | M6 |
| [ ] | MFA challenge: code, recovery code, first-time setup (0.12.x) | M5 |
| [ ] | SSO buttons (when the server has providers) | M6 |
| — | Sign-up, onboarding (first admin) | — |

## 14. Browser-only features and our approach

| Open WebUI feature | MavieChat |
|---|---|
| Pyodide (`execute:python`, Run in the browser), `execute` JavaScript | Answer "unsupported" immediately; Run uses the server's Jupyter |
| Artifacts, tool embeds and HTML previews in iframes | Sandboxed WebViews (at most ~3 live) |
| Mermaid, Vega, KaTeX | One hidden render WebView (cached images); math as native SVG if the spike passes |
| TipTap rich-text input | Plain native text input with markdown (Open WebUI's phone behaviour is plain anyway) |
| Browser STT/TTS, Kokoro | iOS on-device speech, or the server engines |
| Realtime voice, screen capture, Drive/OneDrive pickers, folder upload | Out of scope (web) |
| Encrypted channels (WASM) | Out of scope |
| System notifications + "last active tab" | Toasts in the app; push via webhook relay in M6 |
| Hover previews, Shift-modifiers, drag-and-drop, Tab to accept suggestions | Long-press and tap equivalents where they matter |
