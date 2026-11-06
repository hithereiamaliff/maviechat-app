# MavieChat gateway for OpenCode

Lets the MavieChat iPhone app work with OpenCode on your own computer. The gateway sits between the internet and `opencode serve`: phones pair once with a one-time link, OpenCode's password never leaves the computer, and only the project folders you allow can be reached.

```text
iPhone (MavieChat) ──HTTPS──▶ Caddy ──▶ gateway (127.0.0.1:8080) ──▶ opencode serve (127.0.0.1:4096)
```

MavieChat and this gateway are independent of OpenCode and its makers.

## What you need

- A Linux computer you control, such as a server, with Docker and Docker Compose.
- [OpenCode](https://opencode.ai) 1.19 or later, signed in to at least one AI provider.
- A domain name pointing at the computer, with ports 80 and 443 open, so Caddy can get an HTTPS certificate.
- MavieChat on your iPhone.

## 1. Run OpenCode as a server

`opencode serve` does the work; the gateway only passes requests to it. Give it a long random password and run it as a service. With systemd:

1. Put the password in a file only root can read:

   ```bash
   sudo install -d -m 700 /etc/opencode
   printf 'OPENCODE_SERVER_PASSWORD=%s\n' "$(openssl rand -base64 32)" | sudo tee /etc/opencode/server.env > /dev/null
   sudo chmod 600 /etc/opencode/server.env
   ```

2. Create `/etc/systemd/system/opencode.service` with your own user and folder, and the path that `which opencode` prints:

   ```ini
   [Unit]
   Description=OpenCode server
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=you
   WorkingDirectory=/home/you/projects
   EnvironmentFile=/etc/opencode/server.env
   ExecStart=/usr/local/bin/opencode serve --port 4096
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

3. Start it: `sudo systemctl daemon-reload && sudo systemctl enable --now opencode`.

`opencode serve` listens on 127.0.0.1 unless told otherwise. Keep it there, so the gateway is the only way in. Run it as an ordinary user where you can: OpenCode edits files and runs commands as that user. It reads provider keys and settings when it starts, so restart it after signing in to a provider or changing settings in the terminal.

## 2. Run the gateway

1. Make a folder for it and download three files from this repository:

   ```bash
   mkdir -p ~/maviechat-gateway && cd ~/maviechat-gateway
   base=https://raw.githubusercontent.com/hithereiamaliff/maviechat-gateway/main
   curl -fsSLo compose.yaml "$base/compose.example.yaml"
   curl -fsSLo Caddyfile "$base/Caddyfile"
   curl -fsSLo .env "$base/.env.example"
   chmod 600 .env
   ```

2. Fill in `.env`: your domain, the folders OpenCode may work in from the phone, and OpenCode's password (the one in `/etc/opencode/server.env`).
3. Start it with `docker compose up -d`. After a minute, `curl https://<your domain>/health` should answer `{"ok":true}`.

Both containers use the computer's own network. The gateway listens only on 127.0.0.1:8080 and reaches OpenCode at 127.0.0.1:4096. Caddy answers on ports 80 and 443 and fetches the HTTPS certificate itself.

**Another proxy instead of Caddy** (nginx, Traefik and so on): send HTTPS for your domain to the gateway's port, don't buffer responses (the live event stream stays open), and let the proxy set `X-Forwarded-For`. The gateway believes `X-Forwarded-For` only when the request comes from a loopback or private address, such as a proxy on the same computer or Docker network.

## 3. Pair your iPhone

```bash
docker compose exec gateway maviechat-gateway pair
```

It prints a `maviechat://pair?…` link, plus the address and a code. They work once, for 10 minutes. Open the link on the iPhone (it opens MavieChat), or choose OpenCode in MavieChat and paste the link there, or type the address and code.

- `docker compose exec gateway maviechat-gateway devices` lists the paired phones.
- `docker compose exec gateway maviechat-gateway revoke <id>` unpairs one. A phone can also remove the computer from its accounts.

## Settings

All settings are environment variables, kept in `.env`.

| Variable | What it is |
| --- | --- |
| `PUBLIC_URL` | Where phones reach the gateway, `https://…`. |
| `ALLOWED_FOLDERS` | Project folders OpenCode may work in from the phone, separated by `:`. |
| `OPENCODE_LOGINS` | The OpenCode servers on this computer, as JSON: `[{"id":"me","name":"OpenCode","url":"http://127.0.0.1:4096","passwordEnv":"OPENCODE_PASSWORD"}]`. Each one shows in the app as its own account. `passwordEnv` names the variable holding that server's password, and `username` defaults to `opencode`. |
| The variables `passwordEnv` names | Each OpenCode server's password, the same as its `OPENCODE_SERVER_PASSWORD`. |
| `MACHINE_NAME` | The name the app shows. Defaults to the host name. |
| `HOST` | The address to listen on. The example sets `127.0.0.1`; unset means every address, which suits a container on a Docker network. |
| `PORT` | Default `8080`. |
| `DATA_DIR` | Where paired phones are stored. Default `/data`. |
| `ADMIN_SOCKET` | The socket `maviechat-gateway` uses. Default `/run/maviechat/admin.sock`, inside the container, open only to the gateway's own user. |

`DOMAIN` in `.env` is for Caddy only.

## What the gateway allows

- **Phones:** every request but pairing needs a paired phone's token. Ten wrong tokens from one address in 10 minutes lock it out for 15 minutes.
- **Routes:** only what MavieChat uses: sessions, messages, prompts, stopping, status, approvals, questions, models, agents, projects, folder listings, changes, to-dos and live events, plus the default model. Reading settings answers with the model alone, and changing the default passes on only a checked model name; OpenCode then reloads its projects. Everything else is refused, including the shell, terminals, other settings, provider keys and file contents.
- **Projects:** every project request must name a folder inside `ALLOWED_FOLDERS`. Workspaces are refused.
- **File paths:** folder listings stay inside the project.
- **Approvals:** a session started from the phone asks before editing files and running commands, unless you switch that off for the session in the app.
- **Symlinks:** OpenCode follows a symlink inside an allowed folder that points elsewhere. Keep allowed folders free of such links.

## Notifications

When notifications are on in MavieChat, the phone sends its Expo push token with each prompt. The gateway keeps it in memory for that session, for 6 hours at most (up to 500 sessions, 50 per phone). It forgets the token on restart, when the phone is unpaired, or when Expo reports that the app is gone from the phone.

The gateway follows each OpenCode server's event stream. It sends "OpenCode finished", "couldn't finish", "has a question" or "needs your approval" through Expo's push service (`exp.host`) and Apple. A notification shows the session's title and folder name. It also carries the gateway's address, the OpenCode login, the session ID and the folder's path, so the app can open the session. Commands, file names and reply text never go in a notification. Sessions started in the terminal never notify, and neither does a reply you stopped yourself.

## What it stores and logs

- **Stored:** `DATA_DIR/devices.json` (mode 600) holds each paired phone's ID, name, a hash of its token, when it was paired and last seen, and hashes of pending pairing codes.
- **Logs:** method, route (without IDs or query strings), status and time, plus `push: <kind> sent` lines. They never contain tokens, passwords, paths, titles or message text.

## Updating

```bash
docker compose pull && docker compose up -d
```

Paired phones stay paired: they're kept in the `gateway-data` volume.

## Building and testing

Node 24 runs the TypeScript directly, and there are no runtime packages.

```bash
npm install
npm test
npm run typecheck
docker build -t maviechat-gateway .
```

## Reporting a security problem

Please use this repository's private vulnerability reporting (Security, then Report a vulnerability) rather than a public issue.

## Licence

See [LICENSE](LICENSE).
