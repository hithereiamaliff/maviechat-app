import { defaultModelId, type ChatRecord, type ModelItem } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { useModels, useServerConfig, useUserSettings } from '@/lib/server';

/**
 * The model the next message goes to: your pick in this chat, else the chat's own
 * model, else your default (user settings, then the server's default, then the first model).
 */
export function useModelChoice(chat: ChatRecord | undefined) {
  const models = useModels();
  const settings = useUserSettings();
  const config = useServerConfig();
  const [picked, setPicked] = useState<{ key: string; id: string } | null>(null);

  const key = chat?.id ?? 'new';
  const list = models.data ?? [];
  const defaultId = defaultModelId(list, settings.data, config.data);
  const messages = Object.values(chat?.chat?.history?.messages ?? {});
  const lastModel = [...messages].reverse().find((message) => message.role === 'assistant' && message.model)?.model;
  const chatModel = chat?.chat?.models?.[0] ?? lastModel;
  const visible = (id: string | undefined) => (id && list.some((model) => model.id === id) ? id : undefined);
  const chosenId = (picked?.key === key ? visible(picked.id) : undefined) ?? visible(chatModel) ?? defaultId;
  const model: ModelItem | undefined = list.find((item) => item.id === chosenId);

  return {
    models: list,
    model,
    defaultId,
    loading: models.isLoading,
    pick: (next: ModelItem) => setPicked({ key, id: next.id }),
  };
}
