/**
 * Prepares a scratch Open WebUI to be probed the way production is: an "echo" model (a pipe
 * function that streams back what it was sent and answers title, tags and follow-up tasks, so
 * chats work with no provider or key), a normal user
 * with the production test account's permissions and access to that model, and that user's
 * sign-in in an env file (0600; the password is never printed). Scratch servers only.
 *
 *   npm run scratch:setup -- --env ~/.config/maviechat/owui-scratch-012.env --url http://127.0.0.1:3014 --user-env ~/.config/maviechat/owui-scratch-012-user.env
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  addUser,
  createAdminFunction,
  getAdminFunction,
  getDefaultPermissions,
  OwuiClient,
  OwuiHttpError,
  saveDefaultPermissions,
  setFunctionActive,
  signIn,
  withPermissions,
} from '@maviechat/owui-protocol';
import { expandHome, loadEnvFile } from './env';

const SCRATCH_URLS = new Set(['http://127.0.0.1:3013', 'http://127.0.0.1:3014']);

const ECHO_PIPE = `"""
title: APP PROBE echo
version: 0.0.3
description: A model for MavieChat's probes. It echoes what it was sent, streamed word by word, and answers background tasks (title, tags, follow-ups) in their JSON form.
"""

from typing import Iterator, Union


def text_of(message: dict) -> str:
    content = message.get("content", "")
    if isinstance(content, list):
        content = " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content)


class Pipe:
    def __init__(self):
        self.name = "APP PROBE echo"

    def pipe(self, body: dict) -> Union[str, Iterator[str]]:
        messages = body.get("messages") or []
        last = text_of(messages[-1]) if messages else ""
        # A background task names the JSON it wants; anything else (retrieval's template too) is echoed.
        if '"title":' in last:
            reply = '{"title": "APP PROBE title"}'
        elif '"tags":' in last:
            reply = '{"tags": ["probe"]}'
        elif '"follow_ups":' in last:
            reply = '{"follow_ups": ["Tell me more"]}'
        elif '"queries":' in last:
            reply = '{"queries": []}'
        else:
            context = " ".join(text_of(message) for message in messages[:-1])[:4000]
            reply = "Echo: " + last[:8000] + (" | Context: " + context if context else "")
        if not body.get("stream"):
            return reply
        return (word + " " for word in reply.split(" "))
`;

const { values: args } = parseArgs({ options: { env: { type: 'string' }, url: { type: 'string' }, 'user-env': { type: 'string' } } });
const baseUrl = args.url ?? '';
if (!SCRATCH_URLS.has(baseUrl)) {
  console.error(`Only for the scratch servers (${[...SCRATCH_URLS].join(', ')}).`);
  process.exit(2);
}
const env = (args.env ? loadEnvFile(args.env) : null) ?? {};
const userEnv = args['user-env'] ? expandHome(args['user-env']) : '';
if (!env.OWUI_EMAIL || !env.OWUI_PASSWORD || !userEnv) {
  console.error('Needs --env (the scratch admin) and --user-env (where the probe user’s sign-in goes).');
  process.exit(2);
}

const admin = await signIn(new OwuiClient({ baseUrl, token: null }), env.OWUI_EMAIL, env.OWUI_PASSWORD);
if (admin.kind !== 'session' || !admin.session) throw new Error('The scratch admin couldn’t sign in.');
const client = new OwuiClient({ baseUrl, token: admin.session.token });

// The echo model.
const pipeId = 'app_probe_echo';
const exists = await getAdminFunction(client, pipeId).then(
  () => true,
  (error: unknown) => (error instanceof OwuiHttpError ? false : Promise.reject(error)),
);
if (!exists) await createAdminFunction(client, { id: pipeId, name: 'APP PROBE echo', description: 'Echoes what it was sent, for probes', content: ECHO_PIPE });
// Kept current: an older echo is replaced by this one (saving runs it, on the scratch server only).
else await client.post(`/api/v1/functions/id/${pipeId}/update`, { id: pipeId, name: 'APP PROBE echo', content: ECHO_PIPE, meta: { description: 'Echoes what it was sent, for probes' } });
await setFunctionActive(client, pipeId, true);
console.log(`echo model ${exists ? 'updated' : 'made'}, on`);

// Everyone's defaults as production's test account has them: workspace models and tools, importing models; no sharing.
const defaults = await getDefaultPermissions(client);
await saveDefaultPermissions(client, withPermissions(defaults, { 'workspace.models': true, 'workspace.tools': true, 'workspace.models_import': true }));
console.log('default permissions: workspace models, tools, model import on');

// The probe user, and the echo model shared with them.
if (existsSync(userEnv)) {
  console.log(`probe user: already set up (${userEnv})`);
} else {
  const email = 'scratch-user@maviechat.invalid';
  const password = `Probe-${randomBytes(16).toString('hex')}`;
  const user = await addUser(client, { name: 'Scratch User', email, password, role: 'user' });
  writeFileSync(userEnv, `OWUI_URL=${baseUrl}\nOWUI_EMAIL=${email}\nOWUI_PASSWORD=${password}\n`, { mode: 0o600 });
  await client.post('/api/v1/models/create', { id: pipeId, name: 'APP PROBE echo', base_model_id: null, meta: {}, params: {}, access_grants: [{ principal_type: 'user', principal_id: user.id, permission: 'read' }], is_active: true }).catch(async (error: unknown) => {
    if (!(error instanceof OwuiHttpError)) throw error;
    await client.post('/api/v1/models/model/access/update', { id: pipeId, access_grants: [{ principal_type: 'user', principal_id: user.id, permission: 'read' }] });
  });
  console.log(`probe user made (role user), sign-in saved to ${userEnv}; the echo model shared with them`);
}
