import { forwardRef } from 'react';
import { Pressable, StyleSheet, type HostInstance } from 'react-native';
import { radius, usePalette } from '@/theme';
import { Icon, type IconName } from './Icon';

interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
}

/** A square, borderless icon button with a 44 pt touch target. */
export const IconButton = forwardRef<HostInstance, IconButtonProps>(function IconButton(
  { icon, label, onPress, size = 22, color, disabled = false },
  ref,
) {
  const palette = usePalette();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? palette.surfaceStrong : 'transparent', opacity: disabled ? 0.4 : 1 },
      ]}>
      <Icon name={icon} size={size} color={color ?? palette.text} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
