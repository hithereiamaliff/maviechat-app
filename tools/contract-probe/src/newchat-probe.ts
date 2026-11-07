import {
  getBanners,
  getConfig,
  getUserSettings,
  interfaceChange,
  interfaceOn,
  listModels,
  pinnedModelIds,
  saveUiSettings,
  togglePinnedModel,
  uiPatch,
  updateUserSettings,
  visiblePinnedModels,
  type Capabilities,
  type OwuiClient,
  type UserSettings,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
import type { WriteStep } from './write-probe';

interface NewChatInput {
  client: OwuiClient;
  capabilities: Capabilities;
}

const rawSettings = (client: OwuiClient) => client.get<UserSettings | null>('/api/v1/users/user/settings?raw=true').then((settings) => settings ?? {});

/**
 * The new-chat and sidebar slice against a live server, in the test account, with no model
 * calls: the admin's banners read (shape and count only); the models kept in the sidebar (the
 * admin's default list until the account pins its own) pinned and unpinned the app's way and
 * read back; the "chat" landing mode switched on and read back; then the account's settings put
 * back exactly as they were.
 */
export async function probeNewChat(input: NewChatInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  await check('banners read', async () => {
    const banners = await getBanners(client);
    fixture.banners = shapeOf(banners);
    return `${banners.length} banner(s), ${banners.filter((banner) => banner.dismissible).length} dismissible`;
  });

  if (!capabilities.isAdmin && !capabilities.can('settings.interface', true)) {
    steps.push({ name: 'settings', ok: true, note: 'skipped: this account may not change its settings' });
    return { steps, fixture };
  }

  let original: UserSettings | null = null;
  try {
    original = await rawSettings(client);
    const config = await getConfig(client);
    const models = await listModels(client);

    await check('models kept in the sidebar: pinned and unpinned, the list saved whole', async () => {
      const before = pinnedModelIds(await getUserSettings(client), config);
      const model = models.find((item) => !item.info?.meta?.hidden && !before.includes(item.id));
      if (!model) return `nothing to pin (${models.length} models, ${before.length} pinned)`;
      await saveUiSettings(client, { pinnedModels: togglePinnedModel(before, model.id) });
      const pinned = pinnedModelIds(await getUserSettings(client), config);
      if (pinned[pinned.length - 1] !== model.id) throw new Error('the model was not pinned at the end');
      if (!visiblePinnedModels(pinned, models).some((item) => item.id === model.id)) throw new Error('the pinned model is not shown');
      await saveUiSettings(client, { pinnedModels: togglePinnedModel(pinned, model.id) });
      const unpinned = pinnedModelIds(await getUserSettings(client), config);
      if (unpinned.includes(model.id)) throw new Error('the model was not unpinned');
      return `${typeof config.default_pinned_models === 'string' && config.default_pinned_models ? 'the admin has a default list; ' : ''}pinned and unpinned`;
    });

    await check('the "chat" landing mode switched on and read back', async () => {
      await saveUiSettings(client, interfaceChange('landingPageMode', true));
      if (!interfaceOn((await getUserSettings(client)).ui, 'landingPageMode')) throw new Error('it did not stick');
      await saveUiSettings(client, interfaceChange('landingPageMode', false));
      if (interfaceOn((await getUserSettings(client)).ui, 'landingPageMode')) throw new Error('it did not switch off');
      return 'on, then off';
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
