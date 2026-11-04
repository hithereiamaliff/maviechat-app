# Phone check, 2026-11-04

Everything below is live as over-the-air updates on store build 5. Close and reopen MavieChat twice so the latest update loads. Each line is: where, what to do, what should happen. "Optional" lines change real things or need an outside account; skip them if you like.

## Open WebUI

### A8.1 Settings: General, Interface, Notifications (update a157536e)
- [ ] Settings → General: change the system prompt and one advanced parameter (say temperature), Save, close and reopen Settings: both kept; the web app's Settings → General shows the same.
- [ ] Settings → Interface: flip one switch (say Auto Title): saved at once; the web app shows the same.
- [ ] Settings → Notifications: switch on; send a message, lock the phone: a notification when the reply finishes.

### A8.2 Personalization, Audio, Account (update 9bc79255)
- [ ] Settings → Personalization: Memory on; add a memory, edit it, delete it.
- [ ] Settings → Audio: pick a voice (a sample plays) and a speed; Read Aloud on a reply uses them; "read replies when they finish" reads the next reply by itself.
- [ ] Settings → Account: a new picture (from Photos, cropped square) and name; the sidebar shows them. Put them back.
- [ ] DeepTutor's Settings → Audio: the same voice; its own speed and auto-play.

### A8.3 Data Controls (update 1a3da041)
- [ ] Settings → Data Controls → Export Chats: the share sheet offers a .json file.
- [ ] Import one chat: download a chat as JSON (its menu), then Import Chats with that file: progress, then it appears. Delete the copy.
- [ ] Shared Chats: your links listed; open one; copy one.
- [ ] Manage Files: search by name; open one (Quick Look).
- [ ] Archived Chats → … → Export: a .json in the share sheet.

## DeepTutor

### B5.4 Videos (update 33672d5c)
- [ ] Reading, a collection with a YouTube video: it plays inline; the line playing is marked and followed; tap a line: it jumps there. Leave and come back: it resumes where you were.
- [ ] Your own video or audio file in Reading: the system player; seeking works.
- [ ] In its chat, ask about "what's happening now": the bar shows the moment; a cited time like [1:23] opens the reader there.

### B6.1 Partners (update b5936bfc)
- [ ] Partners → New Partner (face, name, soul, model): it starts; chat: the reply streams. Leave the app mid-reply, come back: it carries on.
- [ ] New conversation; Conversations: open an old one, archive it, bring it back, delete one.
- [ ] Partners page: stop, start, delete a partner.

### B6.2 Partner set-up (update 13d626d0)
- [ ] Partner Settings: face (emoji or photo), name, soul, model, tools, library; Save; reopen: kept.
- [ ] In its chat: attach a file (it reads it); type "/": commands show, /help answers.
- [ ] Branch Conversation from a reply's menu.
- [ ] Link Your Account (Chat Apps card): a code shows.

### B6.3 Groups (update 58d0f695)
- [ ] New Group of two partners, any way of answering; send: both answer. "@one of them": only that one answers. Stop mid-round.
- [ ] On an answer: Follow Up, Ask Another, Pin (the Whiteboard shows it); Sum Up This Round.
- [ ] Discussions, Manage Group, Delete Group.

### B6.4 Partner chat apps (update 6ea038f9)
- [ ] Partner Settings → Chat Apps → Set Up: the apps listed, Matrix under "Not on this server".
- [ ] Telegram's sheet: switch On with nobody allowed, Save: the refusal shows. Cancel.
- [ ] Optional (your own bot from BotFather): its token and your Telegram ID, On, Save; with the partner running the status says Running; message the bot: the partner answers. Then Remove.

### B7.1 Personalization, Personas, Skills (update d47be391)
- [ ] Sidebar → Personalization → All Personalization: six rows with counts (agents, personas, skills, CLI apps).
- [ ] Personas: open a preset (read-only); New Persona (the name formats itself as you type), save; edit it; delete it.
- [ ] Skills: filter by tag; open a built-in (read-only); New Skill with a new tag; edit its text and save; reopen with "Edit the whole file" on: the header is still there. Manage Tags: rename and delete a tag.

### B7.2 Memory (update 4aa19e8c)
- [ ] Personalization → Memory: the big picture and the fact sheets, with counts.
- [ ] Open a fact sheet with facts → tap a fact: its sources; tap one: it opens (a chat, a notebook…).
- [ ] Reword a fact; delete a fact.
- [ ] Optional (uses the model): menu → Update with the Model: it says how many model calls first; the banner counts steps; Stop works; when it's done, Undo puts the sheet back.

### B7.3 Voice, skills and memory in a chat (update b1aa54a8)
- [ ] A DeepTutor chat → + → Voice → teacher: a chip shows; the reply sounds like the teacher.
- [ ] + → Skills → one skill: a chip. + → Use My Memory: a chip.
- [ ] Leave and reopen the chat: the voice and skill chips are still there. Remove them: back to the default.

### B7.4 MCP Services and CLI Apps (update 408286dd)
- [ ] Personalization → MCP Services: "No servers yet"; Browse the Store: search, categories, Show More; open an entry.
- [ ] Optional: install a store server that needs no credentials: it connects and lists tools; open it: Test Connection, switch off and on; then Delete it.
- [ ] CLI Apps: nothing installed; Store: search, "Show ones that can't be installed"; an entry says only admins install (as the admin you get "Install on DeepTutor's Page").

### B7.5 My Agents (update ea718181)
- [ ] Personalization → My Agents: "None yet" and "None connected".
- [ ] Optional: Import from ChatGPT (your export's conversations.json, unzipped in Files): progress, then a ChatGPT group; open a chat and carry it on; in another chat, + → Earlier Chat lists it; rename or delete one in the group.

### B8.1 Co-Writer's notebook (update b3373455)
- [ ] Sidebar → Co-Writer: your pages (Pinned, Recently edited); search finds a subpage and names its parent.
- [ ] Open a page: it reads well (maths, diagrams, tables, images).
- [ ] Edit on the Web: change a line, go back: the page shows the change.
- [ ] New Page: it opens in DeepTutor's editor. Pin and unpin a page.
- [ ] Export Markdown and Export Word: the share sheet offers the file. Import Word: it opens as a new page.
- [ ] If a page has flashcards: Review N Cards → Show Answer → Again or Remembered → "All caught up".

### B8.2 Dito (update a0241962)
- [ ] On a page with text: Ask Dito About This Page → "make the first paragraph shorter". The chat shows the page in a bar.
- [ ] Back on the page: Dito's suggestion with Accept and Dismiss. Accept: the page text changes (the web editor shows it too).
- [ ] The page lists the conversation; delete it.

### B9 Users, for admins (update 0d89e4d4)
- [ ] Account menu → Admin → Users: every account, you as Admin "(you)"; search.
- [ ] Open your own account: no actions, a note that your password is in Settings.
- [ ] Optional (real changes on your server, so use a throwaway account): Add a User "mavie-test" (Standard, any 8+ password); open it; Set a New Password; Make Admin, then Make Ordinary Account; Delete Account (type its name). The web's User Management agrees at each step.

## Questions for you
1. My Agents shows ChatGPT imports in a group of their own; DeepTutor's web page doesn't show them at all. Keep that difference?
2. Connecting an agent program (Claude Code, Codex…) stays on DeepTutor's page, because finding them runs each program on the server. None is installed in the container anyway. Fine?
3. B9's admin actions haven't run against a server yet: your throwaway-account check above is their first live use. Or should I test them on a scratch DeepTutor container first (needs your OK)?
4. DeepTutor 1.7.1 itself (not the app) lets any account list everyone's memory runs (whose prompts carry their memory), change the memory settings every account shares, and connect agent programs on the server with permissive defaults (inert while none is installed). Want an upstream issue drafted for you to post?
