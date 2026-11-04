import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, usePalette } from '@/theme';

export interface Face {
  name: string;
  emoji?: string;
  color?: string;
  avatar?: string;
}

/** A partner's (or group's) face, as DeepTutor draws it: its picture, else its emoji on its colour, else its initial. */
export function PartnerFace({ face, size, running }: { face: Face; size: number; running?: boolean }) {
  const palette = usePalette();
  const round = { width: size, height: size, borderRadius: size / 2 };
  const background = face.color || palette.surfaceStrong;
  return (
    <View style={round}>
      {face.avatar ? (
        <Image source={{ uri: face.avatar }} style={[round, { backgroundColor: palette.surfaceStrong }]} contentFit="cover" accessibilityLabel={`${face.name}’s picture`} />
      ) : (
        <View style={[round, styles.center, { backgroundColor: background }]}>
          {face.emoji ? (
            <Text style={{ fontSize: Math.round(size * 0.5) }}>{face.emoji}</Text>
          ) : (
            <Text style={[styles.initial, { fontSize: Math.round(size * 0.42), color: face.color ? '#FFFFFF' : palette.text }]}>{(face.name.trim()[0] ?? '?').toUpperCase()}</Text>
          )}
        </View>
      )}
      {running !== undefined ? (
        <View
          accessibilityLabel={running ? 'Running' : 'Stopped'}
          style={[styles.dot, { width: size * 0.28, height: size * 0.28, borderRadius: size * 0.14, borderColor: palette.background, backgroundColor: running ? palette.success : palette.textFaint }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.semibold },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2 },
});
