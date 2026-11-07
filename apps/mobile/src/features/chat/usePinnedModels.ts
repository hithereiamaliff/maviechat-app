import { pinnedModelIds, togglePinnedModel, visiblePinnedModels } from '@maviechat/owui-protocol';
import { useMemo } from 'react';
import { useModels, useServerConfig, useUserSettings } from '@/lib/server';
import { useSaveUiSettings } from '@/lib/uiSettings';

/**
 * The models kept in the sidebar, as the web keeps them in your settings (`ui.pinnedModels`,
 * else the admin's default list). Keep in Sidebar adds one at the end; Hide from Sidebar takes
 * it out; the whole list is then saved as yours, as the web saves it.
 */
export function usePinnedModels() {
  const settings = useUserSettings();
  const config = useServerConfig();
  const models = useModels();
  const save = useSaveUiSettings();
  const ids = useMemo(() => pinnedModelIds(settings.data, config.data), [settings.data, config.data]);
  const visible = useMemo(() => visiblePinnedModels(ids, models.data ?? []), [ids, models.data]);
  return {
    ids,
    visible,
    isPinned: (id: string) => ids.includes(id),
    toggle: (id: string) => void save({ pinnedModels: togglePinnedModel(ids, id) }),
  };
}
