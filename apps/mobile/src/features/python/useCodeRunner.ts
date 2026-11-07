import { codeRunEngine, executeCode, splitOutputImages, type CodeOutput } from '@maviechat/owui-protocol';
import { useMemo } from 'react';
import { useLive } from '@/features/live/LiveProvider';
import { useAuthed, useServerConfig } from '@/lib/server';
import type { CodeRun } from '@/markdown/CodeRunContext';

/**
 * A code block's Run for this Open WebUI server, as the web decides it: the server's Jupyter
 * when the admin chose it, otherwise Python on the phone (the web runs it in the browser).
 * Null when the admin turned code execution off.
 */
export function useCodeRunner(): ((code: string) => Promise<CodeRun>) | null {
  const { client } = useAuthed();
  const { runPython } = useLive();
  const engine = codeRunEngine(useServerConfig().data);
  return useMemo(() => {
    if (!engine) return null;
    return async (code: string) => codeRunOf(engine === 'jupyter' ? await executeCode(client, code) : await runPython(code));
  }, [engine, client, runPython]);
}

/** Pictures printed as `data:image/…` lines (a plot's `show()`) are taken out of the text, as the web does. */
export function codeRunOf(output: CodeOutput): CodeRun {
  const printed = splitOutputImages(output.stdout);
  const value = typeof output.result === 'string' ? splitOutputImages(output.result) : null;
  return {
    stdout: printed.text,
    stderr: output.stderr,
    result: value ? value.text || null : output.result,
    images: [...printed.images, ...(value?.images ?? [])],
  };
}
