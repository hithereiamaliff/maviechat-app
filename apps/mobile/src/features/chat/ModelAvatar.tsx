import { modelImagePath } from '@maviechat/owui-protocol';
import { Image } from 'expo-image';
import { useAuthed } from '@/lib/server';
import { usePalette } from '@/theme';

/** A model's picture from the server (the server's own logo when the model has none). */
export function ModelAvatar({ modelId, size, rounded = size / 2 }: { modelId: string; size: number; rounded?: number }) {
  const palette = usePalette();
  const { session } = useAuthed();
  return (
    <Image
      accessible={false}
      source={{ uri: `${session.baseUrl}${modelImagePath(modelId)}`, headers: { Authorization: `Bearer ${session.token}` } }}
      recyclingKey={modelId}
      cachePolicy="memory-disk"
      transition={100}
      style={{ width: size, height: size, borderRadius: rounded, backgroundColor: palette.surfaceStrong }}
    />
  );
}
