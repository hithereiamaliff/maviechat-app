import {
  getUserSettings,
  interfaceChange,
  interfaceOn,
  saveUiSettings,
  speechRate,
  updateUserSettings,
  uiValue,
  type Capabilities,
  type OwuiClient,
  type UserSettings,
  uiPatch,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
import type { WriteStep } from './write-probe';

interface A8Input {
  client: OwuiClient;
  capabilities: Capabilities;
}

const rawSettings = (client: OwuiClient) => client.get<UserSettings | null>('/api/v1/users/user/settings?raw=true').then((settings) => settings ?? {});

/**
 * Milestone 2 slice A8 against a live server, in the test account, with no model calls: the
 * settings read (merged and raw); Interface switches saved the app's way (read, change, write back)
 * and read back, a nested one (`title.auto`) keeping its neighbours, "the default" (`null`)
 * dropped by the server, the system prompt and parameters saved with an unknown parameter kept;
 * then the account's settings put back exactly as they were.
 */
export async function probeA8(input: A8Input): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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

  if (!capabilities.isAdmin && !capabilities.can('settings.interface', true)) {
    steps.push({ name: 'settings', ok: true, note: 'skipped: this account may not change its settings' });
    return { steps, fixture };
  }

  // What the account had, to put back at the end (raw: without an admin's defaults).
  let original: UserSettings | null = null;
  try {
    await check('settings: read, merged and raw', async () => {
      const merged = await getUserSettings(client);
      original = await rawSettings(client);
      fixture.settings = { shape: shapeOf(merged) };
      const keys = Object.keys(original.ui ?? {}).length;
      return `${keys} saved ui key${keys === 1 ? '' : 's'}; merged adds ${Math.max(0, Object.keys(merged.ui ?? {}).length - keys)} from the admin's defaults`;
    });
    if (!original) return { steps, fixture };
    const before = original as UserSettings;
    const keysBefore = Object.keys(before.ui ?? {}).sort();

    await check('Interface: switches saved and read back, other keys kept', async () => {
      const queue = interfaceOn(before.ui, 'enableMessageQueue');
      const follow = interfaceOn(before.ui, 'keepFollowUpPrompts');
      await saveUiSettings(client, { ...interfaceChange('enableMessageQueue', !queue), ...interfaceChange('keepFollowUpPrompts', !follow) });
      const after = await getUserSettings(client);
      if (interfaceOn(after.ui, 'enableMessageQueue') === queue) throw new Error('the message queue switch did not change');
      if (interfaceOn(after.ui, 'keepFollowUpPrompts') === follow) throw new Error('the follow-ups switch did not change');
      const lost = keysBefore.filter((key) => !(key in (after.ui ?? {})));
      if (lost.length) throw new Error(`keys lost: ${lost.join(', ')}`);
      return 'both changed; every other key kept';
    });

    await check('Interface: a nested switch keeps its neighbours; "the default" is dropped', async () => {
      await saveUiSettings(client, { 'title.probeNeighbour': 'kept', ...interfaceChange('titleAuto', false), ...interfaceChange('webSearch', true) });
      let raw = await rawSettings(client);
      if (uiValue(raw.ui, 'title.auto') !== false || uiValue(raw.ui, 'title.probeNeighbour') !== 'kept') throw new Error('title.auto did not keep its neighbour');
      if (uiValue(raw.ui, 'webSearch') !== 'always') throw new Error('web search Always was not saved');
      await saveUiSettings(client, interfaceChange('webSearch', false));
      raw = await rawSettings(client);
      if (raw.ui && 'webSearch' in raw.ui) throw new Error(`web search back to the default is stored as ${JSON.stringify(raw.ui.webSearch)}`);
      return 'title.auto saved beside another title key; webSearch null removed by the server';
    });

    await check('General: system prompt and parameters, an unknown parameter kept', async () => {
      const params = { ...((before.ui?.params as Record<string, unknown> | undefined) ?? {}), probe_unknown: 'kept', temperature: 0.35, stop: ['END', '###'] };
      await saveUiSettings(client, { system: 'APP PROBE: be brief.', params });
      const after = await getUserSettings(client);
      const saved = (after.ui?.params ?? {}) as Record<string, unknown>;
      if (after.ui?.system !== 'APP PROBE: be brief.') throw new Error('the system prompt was not saved');
      if (saved.temperature !== 0.35 || saved.probe_unknown !== 'kept' || JSON.stringify(saved.stop) !== '["END","###"]') throw new Error(`params came back as ${JSON.stringify(saved)}`);
      await saveUiSettings(client, { system: undefined });
      if ('system' in ((await rawSettings(client)).ui ?? {})) throw new Error('an emptied system prompt stayed');
      return 'saved and read back (stop as a list); an emptied prompt removed';
    });

    await check('Personalization and Audio: the Memory switch, auto-playback and speed, audio neighbours kept', async () => {
      const current = await getUserSettings(client);
      const memory = typeof current.ui?.memory === 'boolean' ? current.ui.memory : true;
      const autoPlay = current.ui?.responseAutoPlayback === true;
      const rate = speechRate(current.ui);
      const nextRate = rate === 1.25 ? 1.5 : 1.25;
      await saveUiSettings(client, { 'audio.tts.probeNeighbour': 'kept', 'audio.stt.language': 'ms' });
      await saveUiSettings(client, { memory: !memory, responseAutoPlayback: !autoPlay, 'audio.tts.playbackRate': nextRate });
      // Merged with the admin's defaults: a value equal to one of them is stored as "the default".
      const after = await getUserSettings(client);
      if (after.ui?.memory !== !memory) throw new Error('the Memory switch did not change');
      if ((after.ui?.responseAutoPlayback === true) === autoPlay) throw new Error('auto-playback did not change');
      if (speechRate(after.ui) !== nextRate) throw new Error(`the speed came back as ${String(uiValue(after.ui, 'audio.tts.playbackRate'))}`);
      if (uiValue(after.ui, 'audio.tts.probeNeighbour') !== 'kept' || uiValue(after.ui, 'audio.stt.language') !== 'ms') throw new Error('the speed lost its audio neighbours');
      return `memory ${!memory ? 'on' : 'off'}, auto-playback ${!autoPlay ? 'on' : 'off'}, speed ${nextRate}; other audio settings kept`;
    });
  } finally {
    // Exactly as it was (the raw settings, written whole).
    if (original) {
      await check('settings put back as they were', async () => {
        const saved = original as UserSettings;
        // Keys the probe added go with null: 0.12 keeps a key that's left out.
        await updateUserSettings(client, { ...saved, ui: uiPatch((await rawSettings(client)).ui, saved.ui ?? {}) });
        const now = await rawSettings(client);
        if (JSON.stringify(now.ui ?? {}) !== JSON.stringify((original as UserSettings).ui ?? {})) throw new Error('the settings differ from before');
        return 'identical';
      });
    }
  }
  return { steps, fixture };
}
