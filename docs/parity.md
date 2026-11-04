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
- Controls panel: opens with a left swipe in the chat (on phones, the Controls button in the bar opens it as a full-height sheet; MavieChat uses the button).
- Modals: nearly full screen.
- Menus: anchored popovers.
- Enter: inserts a new line; only the button sends.

## 1. Shell and navigation

| | Item | Source | Mn |
|---|---|---|---|
| [~] | Routes: `/` new chat, `/c/{id}` chat, `/folders/{id}` folder landing, `/s/{id}` shared chat (read-only, Clone). Slice 4: `/folders/{id}`. A shared link opens the server's page in the browser (the app has no link handling yet) | `src/routes/(app)/…` | M1 (`/s` M2) |
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
| [~] | Chat menu: Share, Download (JSON/TXT/PDF), Rename (+ Generate), Mark unread, Pin, Clone, Move to folder, Archive, Delete (`ChatMenu.svelte`). Slice 1: Rename, Pin, Archive, Delete (only with the `chat.delete` permission); slice 4: Rename + Generate, Mark as unread, Move (needs the folders feature); A6: Tags, Share, Download (JSON, text), Clone. PDF waits for a store build | M1 (rename/pin/archive/delete/move); M2 (rest) |
| [~] | User menu: avatar and name (→ Account), status emoji/message, Workspace, Admin Panel, Settings, Sign Out (`UserMenu.svelte`). Slice 4: Workspace and Admin Panel (open on the web until M3/M4), Settings, Connection, Sign Out; A8.2: your picture (else initials) and current name, with Account in Settings; status → later | M1 |
| [~] | Search modal with type/view/location filters, `tag:`, `folder:`, `pinned:`, `shared:`, `archived:`; empty query shows "Pinned & recent" (`layout/SearchModal.svelte`). Slice 1: search field in the sidebar (server search); A6: filter chips under it (Pinned, Shared, Archived, and your tags; typing `tag:` narrows them) | M1 basic, M2 filters |
| web | Channels section and channel pages | — |
| web | Notes section and pages | — |

## 3. Chat header (`chat/Navbar.svelte`, `layout/Navbar/Menu.svelte`)

| | Item | Mn |
|---|---|---|
| [x] | Sidebar button, chat title | M1 |
| [~] | "…" menu: Scroll to top, Artifacts, Share, Download JSON/TXT/PDF, Rename, Copy chat, Move to folder, Archive, Delete, Tags editor. Slice 1: Rename, Pin, Archive, Delete; slice 4: Move, and Unarchive on an archived chat; A6: Tags, Share, Download (JSON, text), Copy, Clone | M1 core, M2 rest |
| [~] | Temporary Chat toggle (new chat only) / Save Chat (temporary chat with messages). Slice 3: the toggle, with the `chat.temporary` / `temporary_enforced` rules | M1 toggle, M2 Save Chat |
| [x] | New Chat button (phone only), Controls (knobs) button | M1 |
| [ ] | Admin banners on the new-chat screen | M2 |

## 4. Model selector — lives in the input bar, bottom right (`chat/ModelSelector.svelte`, `ModelSelector/*`)

| | Item | Mn |
|---|---|---|
| [x] | Search by name/ID/tag; filters All / Local / External / Direct / tag. Slice 5: fuzzy search as on the web, filter chips All / Local / External / tags, hidden models left out. Direct connections live in the browser, so the server's list never has them | M1 |
| [x] | Rows: avatar, name, tags, badges, description, checkmark. Slice 5: picture, size label (Ollama, LM Studio, llama.cpp), loaded dot, tag and External icons, description line, default badge, checkmark | M1 |
| [ ] | Row "…": Keep in Sidebar / Hide from Sidebar, Copy link (Edit/Delete for admins → M3) | M2 |
| [x] | **Compare** toggle for multi-model (permission `multiple_models`). A4 (2026-11-03): the Compare switch beside search; with it on, taps add or remove models (numbered in order, the last one stays) and the picker stays open; off keeps the first. The input bar reads "Model +2". "Set as default" saves the list | M2 |
| [x] | "Set as default" (new chat only) | M1 |
| [ ] | Model controls (preset knobs next to the selector) (`MessageInput/ModelControls.svelte`) | M2 |

## 5. Controls panel (`chat/ChatControls.svelte`, `chat/Controls/*`)

| | Item | Mn |
|---|---|---|
| [x] | Controls tab: chat files (remove one to stop sending it), Valves (tool/function user valves, saved as you change them), System prompt. A3 (2026-11-03): a full-height sheet from the bar's Controls button, in a chat and on New Chat | M2 |
| [~] | Advanced params (Default/Custom each): stream, function calling, reasoning tags, seed, stop, temperature, reasoning effort, logit_bias, max_tokens, top_k, top_p, min_p, frequency/presence penalties, mirostat set, repeat_*, tfs_z, Ollama options (think, format, num_ctx, keep_alive, …) in their own group. Numbers step with − and + (no slider: that needs a native module). Not yet: admins' custom params (`Settings/Advanced/AdvancedParams.svelte`) | M2 |
| [x] | Overview tab: the message tree, every version, the shown branch marked; tap to show that branch and jump to it. The web draws a graph; the phone shows an indented tree (`chat/Overview/*`) | M5 |
| — | Files tab: terminal file browser / Pyodide file system | — |

## 6. New-chat placeholder (`chat/Placeholder.svelte`, `chat/Suggestions.svelte`)

| | Item | Mn |
|---|---|---|
| [x] | Centred input; stacked model avatars; model name or "Hello, {name}"; description; "By author". Slice 5: the model's picture and name (or "Hello, {name}"), two lines of description (tap for the rest), "By author" (community authors link to their page), input asking "How can I help you today?". A4: with Compare the pictures overlap; the last model's details show until you tap another's picture | M1 |
| [x] | "Suggested" prompts (model's own, else admin defaults), shuffled and filtered as you type; tap sends, or inserts if that setting is on. Slice 5: all of it (a model whose own list is empty shows none; nothing past 500 typed characters). When there are none the web shows its own name and version; the app leaves that line out | M1 |
| [ ] | Landing mode "chat" (input pinned to the bottom) | M2 |
| [ ] | Folder landing page: folder header, input, Chats / Knowledge tabs | M2 |

## 7. Message input (`chat/MessageInput.svelte`, `chat/MessageInput/*`)

| | Item | Mn |
|---|---|---|
| [x] | Above the input: scroll-to-bottom arrow, queued messages (Send now / Edit / Delete) | M1 |
| [x] | Ask-user cards (multiple choice, "Recommended", Other, Previous/Next, Submit, timeout) (`chat/AskUserCard.svelte`). A5 (2026-11-03): a question waiting in the last reply shows above the input (answered or skipped with `resolve`); questions asked live (`request:user_input`) open in a sheet with their countdown. Tool approvals: "Allow tool?" with Allow / Deny in the reply | M2 |
| [~] | Attachments: thumbnails (warning if the model lacks vision), file chips with spinner and ×; file preview with "Focused Retrieval / Entire Document". Slice 3: all but the preview; server image-compression limits not applied (needs a native resizer) | M1; preview M2 |
| [x] | Expand to a full-screen editor after 2 lines. Slice 5: the button appears from the third line and opens the "Input" editor | M1 |
| [~] | "+" menu: Upload files, Camera, Attach webpage, Attach previous files, Attach knowledge, Reference chats. Slice 3: Upload Files, Photo Library, Capture | M1 (upload, camera, photos); M2 (rest) |
| — | "+" menu: Google Drive / OneDrive, Compare text, Screen capture | — |
| [~] | Integrations menu: tools (switch each; OAuth Connect), skills, filters, Web Search, Image, Code Interpreter. Slice 3: a sheet with Web Search / Image / Code Interpreter (server, permission and model must allow) and tools; model defaults applied. A5: Tool permissions (Full access / Ask for approval) when the server has them on | M1 (web search/image/code + tools); M2 (skills/filters/OAuth) |
| [~] | Active chips (tap to turn off); Chat Variables `{}`; model knobs. Slice 3: chips (icon only, as on narrow web layouts) | M1 chips, M2 rest |
| [~] | Last button: Stop (generating, empty input) / Dictate + Voice (empty) / Send. Slice 2: Send and Stop; slice 3: Stop + Queue while typing during a reply | M1 (stop/send); M2 (dictate) |
| [~] | `/` commands + saved prompts with variables form (`InputVariablesModal.svelte`); `@` models/knowledge/files/URL; `#` folders/collections/files/URLs; `$` skills. A5 (2026-11-03): a list above the input. `/`: /model, /settings, /temporary (new chat) and your saved prompts, whose own variables get a form (text, long text, choices, checkbox, numbers, dates, email, link, phone, colour; defaults and required). `@`: a model to talk to ("Talking to @model", kept until taken off), knowledge bases and their files, folders, a web address. `#`: knowledge and web addresses. Not yet: /compact, /fork, /status, `$` skills, `:` emoji (the iPhone keyboard has them) | M2 |
| [x] | Built-in variables `{{USER_NAME}}`, `{{CURRENT_DATE}}`, `{{CLIPBOARD}}`, `{{USER_LOCATION}}`, …. A5: all of the web's, filled in as a prompt goes in; `{{USER_LOCATION}}` reads "LOCATION_UNKNOWN" (no location module in build 4), and clipboard pictures aren't attached | M2 |
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
| [x] | Math (KaTeX-equivalent, inline and block). A1 (2026-11-03): MathJax 3.2.2 converts TeX to SVG inside the app (loaded with the first formula) and react-native-svg draws it; inline maths sits on the text baseline, display maths is centred and scrolls sideways when wide, a display formula inside a paragraph gets its own line, broken TeX shows as written, unknown commands in red. Same renderer in DeepTutor | M2 |
| [~] | Code blocks: language label, collapse/expand, Copy, Run (server Jupyter), Preview (HTML/SVG → artifacts), diff blocks; Mermaid and Vega diagrams. Slice 1: label, highlighting, collapse, Copy. A1: Mermaid and Vega/Vega-Lite blocks draw as diagrams once the block is complete (Code/Diagram toggle); HTML and SVG blocks have Preview (sandboxed web view). Left: Run, diff blocks | M1 copy/collapse; M2 run/preview/diagrams |
| [x] | Collapsibles: Reasoning ("Thinking…", "Thought for N seconds"), code interpreter ("Analyzing…/Analyzed"), tool calls ("Executing X…", "View Result from X", input/output, Allow/Deny), grouped "Explored…" | M1 |
| [x] | Sources: "N Sources" pill with favicons, expandable list, detail sheet (excerpts, relevance, page, open) | M1 |
| [~] | Generated images and files; tool HTML embeds (sandboxed). Slice 3: generated images | M1 images, M2 embeds |
| [x] | Error box; blinking cursor while streaming | M1 |
| [~] | Action bar (always on the last message; tap to reveal on others): branch arrows, Edit (Save / Save As Copy), Copy, Read Aloud, Info (usage), Fork, 👍/👎, Continue (last only), Regenerate menu (Suggest a change / Try again / Add details / More concise), custom actions, Delete (when siblings exist), timestamp. Slice 1: arrows, Copy, Info; slice 3: Regenerate menu, Delete; A2 (2026-11-03): Edit (Save / Save As Copy; structured replies edit each text part, steps kept), 👍/👎, Continue (last only), the model's action buttons (`/api/chat/actions/{id}`, changed messages merged); the row scrolls sideways when full. A6: Fork as `/fork`; A7: Read Aloud (the phone's voice; tap again to stop) | M1 (arrows, copy, regenerate, info, delete); M2 (edit, read aloud, fork, rate, continue, actions) |
| [x] | Follow-ups list under the last reply (tap sends, or inserts per setting) | M1 |
| [x] | Rating panel: 1–10, reason chips (up/down sets), comment, Save (`Messages/RateComment.svelte`). A2: shown under the reply after 👍/👎; 6–10 after 👍 and 1–5 after 👎; one reason (the web's keys, our own words); filed with `/api/v1/evaluations/feedback` (created once, then updated) and kept on the reply as `annotation` + `feedbackId`. The web's automatic tag generation for ratings is not done | M2 |
| [x] | Multi-model: full-width swipeable cards; solid border = the branch continued from; per-model arrows; tabs setting; "Merge Responses". A4 (2026-11-03): all of it. The web selects a card when you click it; in the app the reply already reacts to taps, so other cards carry "Continue with this answer". Dots under the cards show which one you're on. Merge also sends the chat id (see protocol §5) | M2 |
| [ ] | Text-selection actions Ask / Explain (`ContentRenderer/FloatingButtons.svelte`) → long-press "Select text" sheet | M2 |

## 9. Chat-level features

| | Item | Mn |
|---|---|---|
| [ ] | Artifacts viewer (combined HTML/CSS/JS, versions, Copy, Download, Full screen) | M2 |
| [x] | Share (private link; read access to users/groups; Update and Copy link; delete link). A6: Create Link (copied), Copy, Share Link through the share sheet, Update Link, Delete Link; who may open it (only people you add, everyone on the server, anyone with the link, as your permissions allow); people found by name or email, and groups. 0.11.3 has no Clone-only / Allow-replies modes | M2 |
| [x] | Download JSON / TXT / PDF (plain-text PDF first); Copy whole chat. A6: JSON and text as files through the share sheet (Save to Files, Mail, AirDrop…), and Copy; A7: PDF (the shown branch as formatted text on A4, iOS's print renderer; maths stays as written) | M2 |
| [x] | Title: live from the server; Rename + Generate. Slice 2: live title and Rename; slice 4: Generate | M1 |
| [x] | Tags: editor; `tag:` search. A6: a Tags sheet (remove, add, your other tags to pick), tag chips under the sidebar search | M2 |
| [x] | Clone (sidebar), Fork from a message, `/fork`. A6: Clone in both menus (opens the copy); `/fork` in the input's `/` menu (from the shown message, as the web; the web has no per-message fork) | M2 |
| [x] | Archive / Unarchive, Pin, Move to folder, Delete, Mark unread; reading a chat clears its dot here and on the web (slice 4) | M1 |
| [~] | Temporary chat (not saved; Save Chat later). Slice 3: temporary chats (photos inline, text files read on the phone; other documents need a saved chat) | M1; Save Chat M2 |
| [~] | Background completions: toast "reply finished" for a chat you're not viewing (tap to open). Slice 2: toast while the app is open; 2026-11-01: also for a reply you left mid-way; push notifications for every account through `services/push-relay` (Open WebUI's server-wide event webhook → Expo push) from store build 4, with tap to open the chat; working end to end on 2026-11-01. While the app is open, banners for every chat but the one on screen (the toast stays for temporary chats and phones without push); Settings says whether a test reached the phone | M1 (while foregrounded); push from build 4 |
| — | Shared-chat presence and typing (Allow replies) | M5 |

## 10. Settings modal (`chat/SettingsModal.svelte`): on phones, a tab strip on top with search behind an icon

| | Tab and contents | Mn |
|---|---|---|
| [~] | General: theme (System/Dark/OLED/Light), language, system prompt, advanced params. Slice 4: theme (kept on the device, as the web keeps it per browser). A8.1 (2026-11-04): system prompt (`ui.system`) and every advanced parameter (`ui.params`, admins' too), saved with Save as on the web; parameters set elsewhere (tool approvals) are kept, where the web's Save drops them; stop sequences are stored as a list. Language: the app is in English for now (the web keeps the language per browser, never on the server) | M1 theme; M2 rest |
| [~] | Interface (A8.1, 2026-11-04), each switch saved at once with your account, and followed by the app: copy with formatting; message queue, temporary chat by default (accounts that may), markdown in your messages and in replies, auto title / follow-ups / tags, auto-copy each reply, follow the reply as it's written, scroll to a message when its version changes, suggestions and follow-ups into the box instead of sending, keep follow-ups under earlier replies, regenerate menu, fold code blocks, open thinking and tool steps, several models as tabs, web search Always (shown on and locked in the composer). Not yet: landing mode, chat bubbles off and show username, fade-in streaming, chat direction, background image, quick actions on selected text. n/a on iPhone: text scale, font, accessibility mode, tab title, location, haptics, update toasts, widescreen, hover previews, terminals, PDF style | M2 |
| — | Interface, input: Enter to send, rich text, formatting toolbar, autocomplete (n/a on a phone keyboard); paste long text as a file (later) | — |
| [~] | Interface, file: default upload mode (A8.1: "Send whole documents" marks attachments `context: full`, as the web does); image compression (later: needs resizing) | M2 |
| [~] | Notifications: its own tab (A8.1) with this iPhone's reply-finished notifications; the web's browser notifications and sound don't apply. Webhook targets (events: chat finished / failed) later | M6 |
| [x] | Personalization (A8.2, 2026-11-04; shown when the admin has memories on and the account may use them): the Memory switch (`ui.memory`, saved at once; off, chats are sent without memories), and while it's on your memories, newest first: search, add and edit (type "About you" or "Context", the words, an optional path, cleaned as the server cleans it), delete, clear all | M2 |
| [~] | Audio: STT engine (server / on-device), language, auto-send; TTS engine (server / on-device), voice, auto-play, speed. A7: Read Aloud always uses the phone's voice (as the web uses the browser's when the server's TTS engine is empty, which is ours). A8.2 (2026-11-04): the voice, from the phone's voices by language with a sample (kept on this iPhone: voices differ by device, as the web's browser voices do; DeepTutor uses it too, and text in another script gets that language's voice); speed (`ui.audio.tts.playbackRate`, 0.5–2×, other audio settings kept) and read replies when they finish (`ui.responseAutoPlayback`; not one you stopped, or one that ended while the app was away), both saved with your account at once. DeepTutor's Settings get the same Audio tab, with speed and auto-play kept on the phone. Not done: dictation (left out, the keyboard's microphone covers it) and so its settings; server voices (our server has no TTS engine) | M2 |
| [x] | Data controls (A8.3, 2026-11-04): import chats from an Open WebUI export (all chats, archived ones, or one downloaded chat) or ChatGPT's `conversations.json` (each conversation as the thread last seen in ChatGPT; hidden instructions, system and tool messages and tool calls left out), sent 25 at a time with progress, files over 50 MB left to the web; export every chat (archived too) as the web's file through the share sheet; Shared Chats (search, sort by updated or title, open, copy or delete a link, delete all links); Archive All and Delete All (with the permission), then a new chat; Manage Files (search by name, sort newest or by name, open in Quick Look, delete). Folder ids that aren't yours are dropped by the server; chat variables come along, which the web leaves behind | M2 |
| [x] | Archived chats: search, Unarchive or Delete each, Unarchive all, Export. Slice 4: all but Export; A8.3: Export (in the same format, so it imports again), with Unarchive All in a menu as on the web | M2 |
| [x] | Account (A8.2, 2026-11-04): picture (a photo from your library or camera, cropped square and made 250 × 250 on the phone; your initials; Gravatar; remove), name, bio, gender (a custom one shown as such, where the web hides it), birth date, your variables (`{{user.variables.…}}`, checked as the server checks them), saved together with Save as on the web; initials made for your old name follow a new one. Password change (the server then signs you out everywhere, so the app signs out and says why). API key when the admin allows it (copy, create a new one, delete) and, for admins, copy the session token. The sidebar shows your picture and current name. 2FA is 0.12.x (M5) | M2 (2FA M5) |
| [x] | About: server version, app version, licences (slice 4; the list is `npm run licenses`) | M1 |
| — | Connections (direct connections), Integrations (tool servers/terminals), Keyboard, Usage | — / later |

## 11. Workspace (M3) (`workspace/*`)

| | Item |
|---|---|
| [~] | Models list: search, sort, enable/hide, import/export JSON, "Try in chat"; menu Edit/Clone/Share/Copy link/Export/Hide/Delete. M3.1 (2026-11-04): search, whose (all, yours, shared with you), tag, order, more on scroll; on/off (writers; off leaves everyone's picker), hide/show, Try in Chat, Copy Link, Clone, Export (with `models_export`), Delete; read-only ones open to view. M3.4: Export All (`/models/export`, with `models_export`). Not yet: import JSON, bulk show/hide (admin), Pin in sidebar (the app's sidebar has no pinned models) |
| [~] | Model editor: avatar, name, ID, description, base model, tags, system prompt, params, suggested prompts, capabilities, default features, built-in tools, knowledge/tools/skills/filters/actions, access. M3.1: picture (photo, camera, default; 250 × 250), name, id (from the name until edited; fixed once made), base model, description, tags, system prompt with the chat and user variables it asks for; everything else kept; new models private. M3.2 (2026-11-04): parameters (every one, as the admin variant shows them, plus custom ones by name; stop sequences saved as a list), capabilities (saved whole, starting from the admin's defaults), features on in new chats, built-in tools (only the ones switched off are saved), knowledge (whole document or searched), tools, skills, filters (on by default for toggleable ones), actions (global ones locked on), suggested prompts (the server's or its own). Not yet: terminal and TTS voice, the JSON preview. M3.3 (2026-11-04): Share… (writers): everyone signed in (with `sharing.public_models`, or already), may change it too; people (search) and groups, each to use or change too; saved at once; a note when the server kept less (it drops what this account may not grant). The list of people and groups shows only with `sharing.models`, as on the web, though the server keeps person and group grants without it. (0.11.3 has no model versions or "model controls": 0.12-era, see M5) |
| [x] | Knowledge: list, create, collection page with folders, add content (files, webpage, text), file viewer (0.11.3 has no test query for local knowledge bases). M3.5 (2026-11-04): list (search, whose, order, more on scroll; files count, connected ones marked), New (name and description, private; opens it), Share…, Delete (models lose it; files stay). Collection page: folders first with the way back up, files (size, date, who; search, in their text too; order; more on scroll); writers: Upload Files (several; the server's size cap and 100 MB on the phone), Add Web Pages (one a line; the server fetches each: pages come in as text named after the address, files as they are), Add Text, New Folder; folders rename, move (a folder browser), delete (keep what's in it, or not); files: the text they were read as (writers correct it: read in again), Open the Original (Quick Look), rename, move, remove (the file is deleted too if you added it, as on the web). Uploads show while the server reads them (from this phone or elsewhere), and why one failed. Name and description, Copy Id, Empty It, Delete. Connected collections read-only. Not yet: upload or sync a whole folder (web), export (admins; a zip), the connected-source settings (admin, M4). 0.11.3 lets two folders share a name at the top level (not inside a folder) |
| [x] | Prompts: name, `/command`, content with variables, versions, access. M3.4 (2026-11-04): list (search, whose, tag, order, more on scroll; on/off for writers: off leaves everyone's `/` menu), New, Clone ("(Clone)", `-clone`), Copy Text, Share…, Export (one, or Export All of what the list finds, with `prompts_export`), Import JSON (the web's and the app's exports; each made private; with `prompts_import`), Delete. Editor: name, command (from the name until edited; letters, digits, `-`, `_`; unique on the server), tags, text with the variables it asks for and the ones it fills in. Changed text saves a version with a note and "make it live" (on by default); name, command and tags alone change without one, as the web's auto-save does (the app saves with Save). Versions: who, when, which is live; open one to see it, Make Live, Copy, Delete (not the live one). 0.11.3 puts the new text in even when a version isn't made live: the sheet says so. Not yet: the version diff (web) |
| [x] | Skills: import (.md, JSON), edit, export (0.11.3 has no .skill/ZIP packages, files or versions). M3.4 (2026-11-04): list (search, whose, order, more on scroll; on/off for writers), New, Clone ("(Clone)", `_clone`), Share…, Export (one, or all with `skills_export`), Import (a `.md` opens as a new skill to look over, named from its header; a JSON export makes each one, private, on or off as it was), Delete. Editor: name, id (new ones only, from the name until edited), description, tags, Markdown; a pasted file's header fills an empty name and description. A save keeps the skill on or off and its other settings (the web's editor switches a skill back on and drops them) |
| [~] | Tools: create, import from URL, code editor (CodeMirror WebView), valves (0.11.3 has no tool history). Saving a tool runs its Python on the server: tool writes are probed on the scratch instance only. M3.6 (2026-11-04): list (search, whose, order; the whole list comes at once, as on the web; version and what it's for), View (header: author, version, what it installs, own settings per person; its code for writers, read-only), Settings… (writers: the values every user of the tool shares, from its schema; secrets hidden; Default or Custom; saved with Save), Share…, Support the Author (when it links one), Export (one, or all, with `tools_export`), Delete. New, edit and import open the web's editor signed in: the app has no code editor, and saving runs the code on the server. Not yet: a native code editor |

## 12. Admin (M4) — the admin tabs live inside the settings modal, as on the web

| | Item |
|---|---|
| [x] | Users: overview, add/edit, roles, pending approvals; Groups and permissions. M4.1 (2026-11-04), a native Admin Panel from the user menu: users (search; order by joined, name, last active or role; 30 a page; active dots; who's waiting, with Approve; add with a role; a user's page with role chips, groups, sign-in providers, what they can use (models, knowledge, tools of how many) and what they may do (defaults OR their groups, worked out on the phone); edit name, email, new password (signs them out); delete, saying their chats go). The primary admin is changed only by themselves; nobody demotes or deletes themselves. Groups: list with member counts, new (starts from today's defaults, as on the web), name, description, who may share with it (members, anyone, nobody), members (add several, take one out), what it allows (marked where everyone has it anyway; keys a group never set stay unset). Default permissions with Server Defaults. Every permission save lists its changes first and is laid over a fresh read. Not yet: a user's chats (needs `enable_admin_chat_access`), CSV import (web) |
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
| Mermaid, Vega, KaTeX | Maths: native SVG from MathJax in the app (no web view). Mermaid and Vega: a sandboxed web view per diagram, sized to fit, renderers pinned on jsDelivr |
| TipTap rich-text input | Plain native text input with markdown (Open WebUI's phone behaviour is plain anyway) |
| Browser STT/TTS, Kokoro | iOS on-device speech, or the server engines |
| Realtime voice, screen capture, Drive/OneDrive pickers, folder upload | Out of scope (web) |
| Encrypted channels (WASM) | Out of scope |
| System notifications + "last active tab" | Toasts in the app; push via webhook relay in M6 |
| Hover previews, Shift-modifiers, drag-and-drop, Tab to accept suggestions | Long-press and tap equivalents where they matter |
