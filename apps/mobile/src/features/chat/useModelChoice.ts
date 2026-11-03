import { defaultModelIds, modelsLabel, type ChatRecord, type ModelItem } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { useCapabilities, useModels, useServerConfig, useUserSettings } from '@/lib/server';

/**
 * The models the next message goes to (several with Compare; the first leads): your pick in
 * this chat, else the chat's own models, else your defaults (user settings, then the server's
 * defaults, then the first model).
 */
export function useModelChoice(chat: ChatRecord | undefined) {
  const models = useModels();
  const settings = useUserSettings();
  const config = useServerConfig();
  const capabilities = useCapabilities();
  const [picked, setPicked] = useState<{ key: string; ids: string[] } | null>(null);

  const key = chat?.id ?? 'new';
  const list = models.data ?? [];
  const defaultIds = defaultModelIds(list, settings.data, config.data);
  const messages = Object.values(chat?.chat?.history?.messages ?? {});
  const lastModel = [...messages].reverse().find((message) => message.role === 'assistant' && message.model)?.model;
  const visible = (ids: (string | undefined)[]) => ids.filter((id): id is string => Boolean(id) && list.some((model) => model.id === id));
  const chatIds = visible(chat?.chat?.models ?? []);
  const candidates = [picked?.key === key ? visible(picked.ids) : [], chatIds.length ? chatIds : visible([lastModel]), defaultIds];
  const ids = candidates.find((group) => group.length > 0) ?? [];
  // As on the web, only admins and accounts allowed to compare get more than one model.
  const compareAllowed = capabilities?.can('chat.multiple_models', true) ?? false;
  const selected = (compareAllowed ? ids : ids.slice(0, 1)).flatMap((id) => list.find((item) => item.id === id) ?? []);

  return {
    models: list,
    /** The models the next message goes to; the first leads (its toggles, tools and suggestions). */
    selected,
    model: selected[0] as ModelItem | undefined,
    label: modelsLabel(selected.map((model) => model.name ?? model.id)),
    defaultIds,
    compareAllowed,
    loading: models.isLoading,
    pick: (next: string[]) => setPicked({ key, ids: next }),
  };
}
