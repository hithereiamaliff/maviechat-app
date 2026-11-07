import {
  chatBackgroundUrl,
  chatDirection,
  getConfig,
  getUserSettings,
  imageCompressionSize,
  imageLimits,
  interfaceChange,
  interfaceOn,
  saveUiSettings,
  uiPatch,
  updateUserSettings,
  type Capabilities,
  type InterfaceKey,
  type OwuiClient,
  type UserSettings,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface InterfaceInput {
  client: OwuiClient;
  capabilities: Capabilities;
}

const rawSettings = (client: OwuiClient) => client.get<UserSettings | null>('/api/v1/users/user/settings?raw=true').then((settings) => settings ?? {});

/** A 1 × 1 white JPEG: a background as the app saves one (a `data:` URL), at the smallest size. */
const PROBE_BACKGROUND =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/**
 * The settings slice against a live server, in the test account, with no model calls: the new
 * Interface switches (bubbles, your name, fading, quick actions, shrinking photos) and the settings
 * that aren't switches (chat direction, the chat background, your quick actions list, the photo
 * size) each saved the app's way and read back, every other setting kept; then the account's
 * settings put back exactly as they were.
 */
export async function probeInterface(input: InterfaceInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!capabilities.isAdmin && !capabilities.can('settings.interface', true)) {
    steps.push({ name: 'settings', ok: true, note: 'skipped: this account may not change its settings' });
    return { steps, fixture };
  }

  let original: UserSettings | null = null;
  try {
    original = await rawSettings(client);
    fixture.keysBefore = Object.keys(original.ui ?? {}).length;

    await check('the new switches saved and read back, each from its default', async () => {
      const flips: [InterfaceKey, boolean][] = [
        ['chatBubble', false],
        ['showUsername', true],
        ['chatFadeStreamingText', false],
        ['showFloatingActionButtons', false],
        ['imageCompression', true],
      ];
      for (const [key, value] of flips) {
        await saveUiSettings(client, interfaceChange(key, value));
        const ui = (await getUserSettings(client)).ui;
        if (interfaceOn(ui, key) !== value) throw new Error(`${key} did not stick`);
      }
      for (const [key, value] of flips) {
        await saveUiSettings(client, interfaceChange(key, !value));
        if (interfaceOn((await getUserSettings(client)).ui, key) !== !value) throw new Error(`${key} did not switch back`);
      }
      return `${flips.length} switches: each saved, read back, and switched back`;
    });

    await check('chat direction, saved as the web saves it', async () => {
      await saveUiSettings(client, { chatDirection: 'RTL' });
      if (chatDirection((await getUserSettings(client)).ui) !== 'RTL') throw new Error('right to left did not stick');
      await saveUiSettings(client, { chatDirection: 'auto' });
      if (chatDirection((await getUserSettings(client)).ui) !== 'auto') throw new Error('automatic did not stick');
      return 'right to left, then automatic';
    });

    await check('a chat background picture, then none', async () => {
      await saveUiSettings(client, { backgroundImageUrl: PROBE_BACKGROUND });
      if (chatBackgroundUrl((await getUserSettings(client)).ui) !== PROBE_BACKGROUND) throw new Error('the picture did not come back as saved');
      await saveUiSettings(client, { backgroundImageUrl: null });
      const ui = (await getUserSettings(client)).ui;
      if (chatBackgroundUrl(ui) !== null) throw new Error('the picture is still there');
      return `saved and read back whole (a data: URL), then removed (${ui && 'backgroundImageUrl' in ui ? 'kept as null' : 'the key dropped'})`;
    });

    await check('your own quick actions, then the defaults again', async () => {
      const mine = [{ id: 'app-probe', label: 'APP PROBE', input: true, prompt: '{{SELECTED_CONTENT}}\n\n\n{{INPUT_CONTENT}}' }];
      await saveUiSettings(client, { floatingActionButtons: mine });
      const saved = (await getUserSettings(client)).ui?.floatingActionButtons;
      if (JSON.stringify(saved) !== JSON.stringify(mine)) throw new Error('the list did not come back as saved');
      await saveUiSettings(client, { floatingActionButtons: null });
      const after = (await getUserSettings(client)).ui?.floatingActionButtons;
      if (Array.isArray(after)) throw new Error('the list is still there');
      return 'the list read back as saved; then back to Ask and Explain';
    });

    await check('the largest photo size, within the admin’s limits', async () => {
      await saveUiSettings(client, { imageCompression: true, imageCompressionSize: { width: 1024, height: null } });
      const ui = (await getUserSettings(client)).ui;
      const size = imageCompressionSize(ui);
      if (size.width !== 1024 || size.height !== null) throw new Error(`read back ${JSON.stringify(size)}`);
      const limits = imageLimits(ui, await getConfig(client));
      fixture.photoLimits = limits;
      if (!limits?.width || limits.width > 1024) throw new Error(`photos would not be shrunk to 1024 wide (${JSON.stringify(limits)})`);
      return `1024 wide, any height; photos then go out at most ${limits.width} wide${limits.height ? ` and ${limits.height} tall` : ''}`;
    });

  } finally {
    if (original) {
      await check('settings put back as they were', async () => {
        const saved = original as UserSettings;
        await updateUserSettings(client, { ...saved, ui: uiPatch((await rawSettings(client)).ui, saved.ui ?? {}) });
        const now = await rawSettings(client);
        if (JSON.stringify(now.ui ?? {}) !== JSON.stringify(saved.ui ?? {})) throw new Error('the settings differ from before');
        return 'identical';
      });
    }
  }
  return { steps, fixture };
}
