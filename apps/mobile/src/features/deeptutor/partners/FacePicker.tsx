import { PARTNER_COLORS } from '@maviechat/deeptutor-protocol';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { MenuTrigger, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { usePictureMaker } from '@/features/settings/PictureMaker';
import { describeError } from '@/lib/errors';
import { fonts, usePalette } from '@/theme';
import { PartnerFace } from './PartnerFace';

export const PARTNER_EMOJIS = ['🦉', '🧠', '📚', '🧪', '🧮', '🗺️', '🎨', '🎓', '🌱', '🦊', '🐼', '🐙', '🤖', '✨', '💬', '🧭'];

const PHOTO: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.7,
  base64: true,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

/**
 * A partner's face, as DeepTutor's editor has it: a photo (cropped square and made 128 × 128 on
 * the phone, as the web does in the browser), or an emoji on one of its colours.
 */
export function FacePicker({
  name,
  emoji,
  color,
  avatar,
  onChange,
}: {
  name: string;
  emoji: string;
  color: string;
  avatar: string;
  onChange: (face: { emoji?: string; color?: string; avatar?: string }) => void;
}) {
  const palette = usePalette();
  const toast = useToast();
  const picture = usePictureMaker();
  const [making, setMaking] = useState(false);

  const fromPhotos = async (camera: boolean) => {
    if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      toast('Allow camera access for MavieChat in Settings to take a photo.', 'error');
      return;
    }
    const result = camera ? await ImagePicker.launchCameraAsync(PHOTO) : await ImagePicker.launchImageLibraryAsync(PHOTO);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset?.base64) return;
    setMaking(true);
    try {
      onChange({ avatar: await picture.maker.square(`data:image/jpeg;base64,${asset.base64}`, 128) });
    } catch (error) {
      toast(`Couldn’t use that photo: ${describeError(error)}`, 'error');
    } finally {
      setMaking(false);
    }
  };
  const items: MenuItem[] = [
    { key: 'photos', label: 'Choose Photo', icon: 'photo', onPress: () => void fromPhotos(false) },
    { key: 'camera', label: 'Take Photo', icon: 'camera', onPress: () => void fromPhotos(true) },
    ...(avatar ? [{ key: 'remove', label: 'Use the Emoji', icon: 'x-mark' as const, onPress: () => onChange({ avatar: '' }) }] : []),
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.preview}>
        <MenuTrigger label="Change the picture" items={items}>
          <View>
            <PartnerFace face={{ name: name || 'Partner', emoji, color, avatar }} size={72} />
            <View style={[styles.badge, { backgroundColor: palette.background, borderColor: palette.border }]}>
              {making ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Icon name="camera" size={14} color={palette.text} />}
            </View>
          </View>
        </MenuTrigger>
        <Text style={[styles.name, { color: name ? palette.text : palette.textFaint }]} numberOfLines={1}>
          {name || 'Your partner'}
        </Text>
        {avatar ? <Text style={[styles.hint, { color: palette.textFaint }]}>The photo shows instead of the emoji.</Text> : null}
      </View>
      <View style={styles.emojis}>
        {PARTNER_EMOJIS.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="radio"
            accessibilityState={{ selected: item === emoji }}
            accessibilityLabel={item}
            onPress={() => onChange({ emoji: item })}
            style={[styles.emoji, { borderColor: item === emoji ? palette.text : 'transparent' }]}>
            <Text style={styles.emojiText}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.colors}>
        {PARTNER_COLORS.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="radio"
            accessibilityState={{ selected: item === color }}
            accessibilityLabel={`Colour ${item}`}
            onPress={() => onChange({ color: item })}
            style={[styles.swatch, { backgroundColor: item, borderColor: item === color ? palette.text : palette.background }]}
          />
        ))}
      </View>
      {picture.element}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  preview: { alignItems: 'center', gap: 6, marginVertical: 8 },
  badge: { position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.semibold, fontSize: 18 },
  hint: { fontFamily: fonts.regular, fontSize: 12 },
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  emoji: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 22 },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 3 },
});
