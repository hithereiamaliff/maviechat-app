import { profileImageSource } from '@maviechat/owui-protocol';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/session/SessionProvider';
import { fonts, usePalette } from '@/theme';

/** A name's initials: the first and last word's first letters ("?" for none). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

/**
 * Your picture in a circle: the one on your Open WebUI account (loaded with your token when it's
 * on your server), else your initials.
 */
export function UserAvatar({ name, picture, size }: { name: string; picture?: string | null; size: number }) {
  const palette = usePalette();
  const owui = useSession();
  const session = owui.state.status === 'signed-in' ? owui.state.session : null;
  const source = session ? profileImageSource(picture, session.baseUrl) : null;
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (source && session) {
    return (
      <Image
        source={{ uri: source.uri, headers: source.authed ? { Authorization: `Bearer ${session.token}` } : undefined }}
        style={[round, { backgroundColor: palette.surfaceStrong }]}
        contentFit="cover"
        accessibilityLabel={`${name}’s picture`}
      />
    );
  }
  return (
    <View style={[round, styles.initials, { backgroundColor: palette.surfaceStrong }]}>
      <Text style={[styles.text, { color: palette.text, fontSize: Math.round(size * 0.4) }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.semibold },
});
