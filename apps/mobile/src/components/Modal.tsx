import { useEffect, useEffectEvent, useRef, type ComponentType } from 'react';
// The one place React Native's own Modal is imported (see eslint.config.js).
// eslint-disable-next-line no-restricted-imports
import { Modal as NativeModal, Platform, StyleSheet, View, type ModalProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme';

/**
 * Android's half of what iOS does for a modal by itself. React Native calls `onDismiss` on iOS
 * only, so on Android an action waiting for a sheet or menu to close would never run: here it runs
 * once the modal has been hidden. And Android draws a full-screen modal under the status bar
 * (edge to edge), where iOS shows the same sheet below it, so the sheet starts below it here too.
 */
function AndroidModal({ onDismiss, children, ...props }: ModalProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const visible = props.visible !== false;
  const shown = useRef(visible);
  const dismissed = useEffectEvent(() => onDismiss?.());

  useEffect(() => {
    const closed = shown.current && !visible;
    shown.current = visible;
    if (!closed) return;
    const timer = setTimeout(() => dismissed(), 0);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <NativeModal {...props}>
      {props.transparent ? children : <View style={[styles.sheet, { paddingTop: insets.top, backgroundColor: palette.background }]}>{children}</View>}
    </NativeModal>
  );
}

/** React Native's Modal: on iPhone exactly that, on Android with `AndroidModal`'s additions. */
export const Modal: ComponentType<ModalProps> = Platform.OS === 'android' ? AndroidModal : NativeModal;

const styles = StyleSheet.create({
  sheet: { flex: 1 },
});
