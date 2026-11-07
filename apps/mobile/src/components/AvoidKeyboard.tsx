import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAvoidingView as KeyboardControllerAvoidingView } from 'react-native-keyboard-controller';

/**
 * Keeps the sign-in and pairing forms above the keyboard. On iPhone it's React Native's own, as
 * these screens always had. Android gets keyboard-controller's, as the app's other screens use;
 * React Native's was off there, which left the fields under the keyboard.
 */
export function AvoidKeyboard({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView style={style} behavior="padding">
        {children}
      </KeyboardAvoidingView>
    );
  }
  return (
    <KeyboardControllerAvoidingView style={style} behavior="padding">
      {children}
    </KeyboardControllerAvoidingView>
  );
}
