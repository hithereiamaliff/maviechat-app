# Phone check, 2026-11-09

Everything since the last checks you confirmed (2026-11-06): the updates of 2026-11-07, 11-08 and 11-09. All of it is live over the air on store build 6. Close MavieChat completely (swipe it away) and open it again; if nothing's new, do it once more. The latest update is `c2668bde`.

Each line says where to go, what to do, and what should happen. Lines marked **Optional** change something real, or need an account or service you may not have; skip them if you like. Admin settings save for everyone on the server, so most admin lines say "look, then Cancel".

If you haven't been through the earlier list, [phone-check-2026-11-04.md](phone-check-2026-11-04.md) still has the A8 settings and DeepTutor items.

## The chat

### Folders (2026-11-07)
- [ ] Sidebar → the **+** beside Folders → **New Folder**: name it, Save. It's in the sidebar.
- [ ] Tap the folder: its page opens. Type a message there: the new chat goes into the folder.
- [ ] On the folder's page, tap the round icon → pick an emoji. It shows beside the folder in the sidebar. Pick it again to take it off.
- [ ] The folder's **…** → **Edit**: change the description or system prompt, Save. Reopen: kept.
- [ ] **Optional:** someone shares a folder with you on the web: it shows in your sidebar; their chats open read only.

### New chat and the sidebar (2026-11-07)
- [ ] New chat → the model name at the top → a model's **…** → **Keep in Sidebar**: it shows in the sidebar's pinned models. Tap it: a new chat with it.
- [ ] A pinned model's **…** → **Change Order…** (2026-11-08): move one with the arrows, then Cancel.
- [ ] Tap your name at the bottom of the sidebar → **Sidebar Shortcuts…** (2026-11-08): switch one, then Cancel.
- [ ] **Optional:** an admin banner (Settings → Admin → General → Banners) shows above a new chat.

### In the chat (2026-11-07)
- [ ] Ask for "a small HTML page with a button" or "an SVG of a star": the reply offers the artifact; tap it to open the viewer.
- [ ] Under a reply, tap **Select Text** (the cursor icon) → select a few words → **Ask** or **Explain**: the message box gets a question about them.
- [ ] Copy a photo in Photos, then the message box's **+** → **Paste Image**: it's attached.
- [ ] A table in a reply (ask for one): columns line up, with **Copy** and **Save as CSV** beside it.
- [ ] Ask for a short Python program: its code block has **Run**, and the result shows under it.
- [ ] Attach a photo and tap Send at once (2026-11-08): the message goes as soon as the photo is up.
- [ ] Tap a reply's time (2026-11-08): the whole date shows.

### The message box (2026-11-07)
- [ ] **+** → **Attach Webpage**: give an address; it's attached as a page.
- [ ] **+** → **Attach Files**, **Attach Knowledge**, **Attach Notes**, **Reference Chats**: each opens its list; pick one, and it's attached.
- [ ] Tap an attachment's chip: its preview opens.
- [ ] The **Integrations** button beside **+**: skills and the model's filters are listed with switches.
- [ ] Type `$`: your skills are listed. Type `/`: commands, your prompts and skills.
- [ ] In a temporary chat with messages: **Save Chat** in the bar saves it, and it opens.
- [ ] **+** → **Compare Text…** (2026-11-09), or type `/compare`: paste a changed version of your message, **Compare**, keep or drop each change, **Use**. The message box has the result.

### Search and menus (2026-11-07)
- [ ] The sidebar's search: the **Untagged** and folder chips filter; results show their date and the matching text; more load as you scroll.
- [ ] In a long chat, **Scroll to Top** in the chat's menu.
- [ ] Type `/status` in a chat with messages: what the chat uses and has running.

### Your status (2026-11-07)
- [ ] Tap your name at the bottom of the sidebar → **Update Your Status** → **Set Your Status**: an emoji and a message. It shows under your name, with the green dot. **Clear Status** takes it off.
- [ ] In the message box, type `:smi`: emoji are suggested; pick one and it replaces `:smi`.

### Links (2026-11-07)
- [ ] In a reply or a note, tap a link to one of your server's chats or notes: it opens in the app, not the browser.
- [ ] A shared chat link (`/s/…`): the app's own page opens, with **Clone Chat**.

## Notes (2026-11-07)
- [ ] Sidebar → Notes: the list has date headings; its menu has **Show as Grid** / **Show as List**.
- [ ] New note: **Write** with the formatting bar (Bold, lists, Checklist…), then **Preview**: tick a box there. Leave and come back: kept.
- [ ] **Undo** and **Redo** at the top work.
- [ ] Beside the title, **Generate a title from the text** suggests a title.
- [ ] **Add files, photos or a recording** → **Add Photos…**: the photo shows in the note.
- [ ] **Chat about this note**: the note's chat opens; ask something; **Insert** a reply into the note.
- [ ] The note's menu → **Enhance**: the text comes back improved; keep it or undo.
- [ ] The note's **…** → **Download…** → **Markdown (.md)**: the share sheet offers a file. Then delete the note.

## Settings

### Interface (2026-11-07)
- [ ] Settings → Interface → **Chat bubbles** off: messages show without bubbles, with your name. Put it back.
- [ ] **Fade in replies as they’re written** on: a new reply fades in word by word.
- [ ] **Chat direction** → Right to left: text runs from the right. Put it back to Automatic.
- [ ] **Chat background** → **Choose Photo**: chats show it faintly. Then remove it.
- [ ] **Quick actions on selected text** → **Edit quick actions**: add one, Save; it shows when you select text in a reply.

### Notifications (2026-11-08)
- [ ] Settings → Notifications: your notification webhooks are listed (the server has them on). Open one's **…**: **Send Test**, **Make Default**, **Edit…**, **Remove**. **Optional:** Send Test to one you own.

## Workspace

### Models (2026-11-07)
- [ ] Workspace → Models → **…** at the top: **Import…**, **Turn All On** / **Turn All Off**, **Show All in Pickers**. Look, don't use.
- [ ] Open a model → its editor: the terminal, voice and **JSON Preview** sections are there. Cancel.
- [ ] A wide table or code block in a chat scrolls sideways without the sidebar opening.

### Tools: code editor (2026-11-08)
- [ ] Workspace → Tools → a tool's **…** → **Edit Code**: type a little, **Tab**, **Find**, then Cancel and discard. Saving would run the code on your server.

### Knowledge (2026-11-09)
- [ ] Workspace → Knowledge → a collection's **…** → **Export as Text (ZIP)**: the share sheet offers a ZIP. Save to Files, or Cancel.

### Prompts (2026-11-09)
- [ ] Workspace → Prompts → a prompt with two or more versions → **Versions** → tap one → **Compare with Live**, then **Compare with Previous**: lines taken out (−) and put in (+). **Show Text** goes back.
- [ ] Open a prompt → **Compare with a Revision…** under its text: paste or type a changed version → **Compare** → choose **Revision**, **Current** or **Both** for each change → **Apply**: the text field has the result. Cancel the prompt to discard.

### Chat Variables (2026-11-08)
- [ ] **Optional:** a Workspace model whose system prompt has `{{chat.variables.topic | select:options=["a","b"]:required}}`. Start a chat with it: **Chat Variables** beside the message box asks for the topic before the first message.

## Admin (you're the admin; these save for everyone)

### General (2026-11-08)
- [ ] Settings → Admin → General → **Default Interface Settings** → Everyone’s Interface settings: open, look, Cancel.
- [ ] At the end of General, the event webhooks: open MavieChat's notification webhook and tap **Show** for its address. Don't change it.

### Models (2026-11-08)
- [ ] Settings → Admin → Models: **Model Defaults** (open, look, Cancel); **Order in Pickers** (move one, Cancel); the **…** → **Export All** (the share sheet offers a file).
- [ ] Tap a model: its settings open; Cancel. A model's **…** → **Clone**: Cancel. Switch the views (On, Off, Hidden…).

### Users (2026-11-08)
- [ ] Admin Panel → Users → someone → **Chats**: their chats; open one (read only); back.
- [ ] **Optional:** Users → **…** → **Import from CSV…** with a small file of test accounts (it creates them; delete them after).

### Authentication (2026-11-08)
- [ ] Settings → Admin → Authentication: scroll to **LDAP** and **Single sign-on**. Look, don't save.

### External Knowledge (2026-11-09)
- [ ] Settings → Admin → **External Knowledge**: "None yet". **Add Source**: look at the form, then Cancel. Saving needs a real vector database.

## Not on your server yet

These need Open WebUI 0.12 (your server runs 0.11.3, where the app hides them), or a service none of your servers has. They passed on the 0.12.5 test server.
- Your own two-step sign-in (Settings → Account)
- Versions of tools, functions, skills and models (each one's **…** → **Versions…**)
- Interface Text (Admin → General) and Apps (Admin → Apps; the Apps switch in General)
- Model knobs in the chat (0.12)
- Connect for tools that sign in to their own service (no such tool on your servers)
- LDAP and single sign-on at sign-in (no directory or provider on your servers)
