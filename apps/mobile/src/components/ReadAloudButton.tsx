import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { readAloud, stopReading, useReadingAloud } from '@/lib/readAloud';
import { usePalette } from '@/theme';

/** A reply's Read Aloud button: reads it in the phone's voice; while it reads, the button stops it. */
export function ReadAloudButton({ id, markdown, rate }: { id: string; markdown: string; rate?: number }) {
  const palette = usePalette();
  const toast = useToast();
  const reading = useReadingAloud(id);
  return (
    <IconButton
      icon={reading ? 'stop-circle' : 'speaker-wave'}
      label={reading ? 'Stop reading aloud' : 'Read aloud'}
      size={18}
      color={reading ? palette.text : palette.textMuted}
      onPress={() => {
        if (reading) stopReading();
        else if (!readAloud(id, markdown, { rate })) toast('There is nothing to read aloud in this reply.');
      }}
    />
  );
}
