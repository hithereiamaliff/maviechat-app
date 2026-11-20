# Phone check: iPad and big screens (2026-11-15)

The latest update is `77dfb2a7`. To get it, close MavieChat completely (swipe it away) and open it again; if nothing's new, do it once more.

## On your iPhone, now

Nothing should look different.

- [ ] Open WebUI: tap **Open sidebar** (☰, top left): the sidebar slides in. Tap a chat: it closes. Swipe right anywhere: it opens again.
- [ ] The sidebar's own ☰ at its top (**Close sidebar**) closes it.
- [ ] The same in DeepTutor and in OpenCode.
- [ ] Settings → **Interface**: there's no **Use the full width** switch on the iPhone.
- [ ] Notes → … → **Show as Grid**: still two cards a row.
- [ ] Typing on the screen keyboard: Return still starts a new line in the message box, in all three spaces.

## On your iPad, with the 1.0.0 TestFlight build

The iPad switch comes with that build; until then the iPad shows the iPhone-sized window.

- [ ] The app fills the iPad's screen.
- [ ] Open WebUI, DeepTutor and OpenCode: the sidebar sits beside the content. Tapping a chat keeps it there.
- [ ] The sidebar's ☰ (**Hide sidebar**) hides it, and the ☰ that appears at the top left (**Open sidebar**) brings it back.
- [ ] Turn the iPad: the app turns too and stays on the same screen.
- [ ] On a big iPad sideways with the sidebar hidden, chats sit in a column in the middle. Settings → **Interface** → **Use the full width**: chats fill the width (the web follows it too). Turn it off again.
- [ ] Put MavieChat in Split View or Slide Over beside another app: in a narrow window it's the phone layout, with the sliding sidebar.
- [ ] Notes → **Show as Grid**: three cards a row.
- [ ] Share or export something (a chat's … → **Download**): the share pop-up appears in the middle of the screen.
- [ ] If you sign in again: the sign-in form is a column in the middle.

### With a keyboard attached (Magic Keyboard or any Bluetooth keyboard)

- [ ] In a chat, type a message and press Return: it sends. Shift-Return starts a new line instead.
- [ ] Type `/` and press Return while the list shows: the first entry is picked, not sent.
- [ ] The same in DeepTutor and OpenCode: Return sends, Shift-Return starts a new line.
- [ ] Hold ⌘: the iPad lists MavieChat's shortcuts: **New Chat**, **Search**, **Settings**, **Show or Hide Sidebar**, **Go to Message Box** (and **Send Message** while you're typing).
- [ ] ⌘⇧O starts a new chat (a new session in OpenCode). ⌘K opens the sidebar's search. ⌘. opens Settings (Open WebUI and DeepTutor). ⌘⇧S hides or shows the sidebar. ⇧Esc puts the cursor back in the message box.
- [ ] In a note or a search field, Return still works as usual (a new line, or search).
- [ ] If you type in Chinese, Japanese or Korean: Return first finishes the word you're composing; the next Return sends.

## Added 18 November: the privacy policy link

The update is `597019a1` (Android: `85a44b72`). It arrives the same way: close MavieChat completely and open it again, twice if needed. Settings → **About** then shows it on the **Update** line as `01a1ec59`.

- [ ] Open WebUI: ☰ → your name at the bottom → **Settings** → **About** → **Privacy Policy**: the policy opens in the in-app browser.
- [ ] DeepTutor: the same, from DeepTutor's **Settings** → **About**.
- [ ] OpenCode: ☰ → your machine's name at the bottom → **Privacy Policy**.
- [ ] If you're ever signed out of everything: the first screen shows **Privacy Policy** at the bottom.

## Added 20 November: the notice about AI services

The update is `136cad78` (Android: `98bd2dd2`). It arrives the same way: close MavieChat completely and open it again, twice if needed. Settings → **About** then shows it on the **Update** line as `01a1f8da`.

It's asked once per server on this phone, so each space shows it only on its first send.

- [ ] Open WebUI: send a message in any chat. Before it goes, **Where your messages go** names chat.techmavie.digital. Tap **Not Now**: nothing is sent, no error appears, and your text is back in the message box.
- [ ] Send it again and tap **Continue**: it goes. Send another: no notice this time.
- [ ] DeepTutor: send a message. The notice names learn.techmavie.digital. **Not Now** keeps your text, with no error; **Continue** sends it.
- [ ] OpenCode: send a prompt in a session. The notice names your machine and the AI providers set up there. **Not Now** keeps your text; **Continue** sends it.
- [ ] On Android, tapping outside the notice counts as **Not Now**.
