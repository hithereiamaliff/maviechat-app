import { useCallback } from 'react';
import { useOcModels } from '@/features/opencode/queries';
import { useAuthed } from '@/lib/server';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { askAiNotice } from './askAiNotice';
import { openCodeNotice, serverNotice } from './notice';

/** Open WebUI: asks once for the server in use before the first message or file goes there. */
export function useOwuiAiNotice(): () => Promise<boolean> {
  const { session } = useAuthed();
  return useCallback(() => askAiNotice(serverNotice('owui', session.baseUrl)), [session.baseUrl]);
}

/** DeepTutor: as Open WebUI's, for the DeepTutor server in use. */
export function useDtAiNotice(): () => Promise<boolean> {
  const { session } = useDtAuthed();
  return useCallback(() => askAiNotice(serverNotice('deeptutor', session.baseUrl)), [session.baseUrl]);
}

/** OpenCode: asks once for the machine and login in use, naming the AI providers set up there. */
export function useOcAiNotice(directory: string | null): () => Promise<boolean> {
  const { session } = useOcAuthed();
  const models = useOcModels(directory).data?.models;
  return useCallback(
    () =>
      askAiNotice(
        openCodeNotice({ gatewayUrl: session.gatewayUrl, machineName: session.machineName, loginId: session.login.id }, (models ?? []).map((model) => model.provider)),
      ),
    [session.gatewayUrl, session.machineName, session.login.id, models],
  );
}
