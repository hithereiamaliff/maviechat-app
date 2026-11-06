/*
 * `maviechat-gateway`, run inside the container:
 *   pair            a one-time link (and code) that pairs a phone, valid for 10 minutes
 *   devices         the paired phones
 *   revoke <id>     unpair one
 */
import { request } from 'node:http';

// The gateway's admin socket (server.ts): only its own user can open it.
const adminSocket = process.env.ADMIN_SOCKET || '/run/maviechat/admin.sock';
const [command, argument] = process.argv.slice(2);

function call(method: string, pathname: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const asked = request({ socketPath: adminSocket, path: pathname, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const status = response.statusCode ?? 500;
        if (status >= 400) return reject(new Error(`the gateway answered ${status}`));
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(text ? JSON.parse(text) : null);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    asked.on('error', reject);
    asked.end();
  });
}

async function main(): Promise<void> {
  if (command === 'pair') {
    const result = (await call('POST', '/admin/pair')) as { code: string; expiresAt: number; link: string; machine: string; url: string };
    const minutes = Math.round((result.expiresAt - Date.now()) / 60_000);
    console.log(`Pair a phone with ${result.machine}. This works once, for the next ${minutes} minutes.\n`);
    console.log('On the iPhone, open this link (it opens MavieChat), or paste it in MavieChat → OpenCode → Pair a Machine:\n');
    console.log(`  ${result.link}\n`);
    console.log(`Or type the address and code there:\n  Address: ${result.url}\n  Code:    ${result.code}`);
    return;
  }
  if (command === 'devices') {
    const devices = (await call('GET', '/admin/devices')) as { id: string; name: string; createdAt: number; lastSeenAt: number }[];
    if (devices.length === 0) console.log('No phones are paired.');
    for (const device of devices) {
      console.log(`${device.id}  ${device.name}  paired ${new Date(device.createdAt).toISOString().slice(0, 10)}, last seen ${new Date(device.lastSeenAt).toISOString().slice(0, 16).replace('T', ' ')}`);
    }
    return;
  }
  if (command === 'revoke' && argument) {
    await call('DELETE', `/admin/devices/${encodeURIComponent(argument)}`);
    console.log(`Unpaired ${argument}.`);
    return;
  }
  console.log('Usage: maviechat-gateway pair | devices | revoke <device id>');
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`maviechat-gateway: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
