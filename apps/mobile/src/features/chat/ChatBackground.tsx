import { chatBackgroundUrl, getFolder } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { StyleSheet, useColorScheme, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useAuthed, useCapabilities, useUserSettings } from '@/lib/server';
import { usePalette } from '@/theme';

/**
 * A picture under a chat or a folder's page, fading into the page's colour towards the bottom so
 * the text stays readable, as on the web (85% over it at the top in light, 90% in dark).
 */
export function ChatBackground({ uri }: { uri: string }) {
  const palette = usePalette();
  const dark = useColorScheme() === 'dark';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="chat-fade" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={palette.background} stopOpacity={1} />
            <Stop offset="1" stopColor={palette.background} stopOpacity={dark ? 0.9 : 0.85} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#chat-fade)" />
      </Svg>
    </View>
  );
}

/** The picture behind a chat, as the web picks it: its folder's, else yours from Settings → Interface; null for none. */
export function useChatBackground(folderId: string | null | undefined): string | null {
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const foldersOn = capabilities?.feature('folders') ?? false;
  const folder = useQuery({ queryKey: ['folder', folderId], queryFn: () => getFolder(client, folderId as string), enabled: foldersOn && Boolean(folderId) });
  const own = folder.data?.meta?.background_image_url;
  return typeof own === 'string' && own ? own : chatBackgroundUrl(settings.data?.ui);
}
