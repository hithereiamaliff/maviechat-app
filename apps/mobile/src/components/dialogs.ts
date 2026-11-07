// The one place React Native's iOS-only prompt and action sheet are used (see eslint.config.js).
// eslint-disable-next-line no-restricted-imports
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { choiceRequest, openDialog, promptRequest, sheetRequest, type PromptButton } from '@/lib/dialogQueue';

/**
 * `Alert.alert`, for alerts with more than three buttons. On iPhone it's exactly that. Android's
 * alert shows three at most and drops the rest, Cancel included, so there they become an action
 * sheet. Alerts with three buttons or fewer can keep using `Alert.alert`.
 */
export const showAlert: typeof Alert.alert = (...args) => {
  const [title, message, buttons] = args;
  if (Platform.OS === 'ios' || !buttons || buttons.length <= 3) return Alert.alert(...args);
  openDialog(choiceRequest(title, message, buttons as readonly PromptButton[]));
};

/**
 * `Alert.prompt`: on iPhone exactly that, with the same arguments. On Android, where React
 * Native's does nothing, the app shows its own (`DialogHost`).
 */
export const showPrompt: typeof Alert.prompt = (...args) => {
  // eslint-disable-next-line no-restricted-properties
  if (Platform.OS === 'ios') return Alert.prompt(...args);
  const [title, message, callbackOrButtons, type, defaultValue, keyboardType] = args;
  openDialog(promptRequest(title, message, callbackOrButtons as ((value: string) => void) | readonly PromptButton[] | null | undefined, type, defaultValue, keyboardType));
};

/**
 * `ActionSheetIOS.showActionSheetWithOptions`: on iPhone exactly that, with the same arguments.
 * On Android, where React Native's throws, the app shows its own sheet (`DialogHost`).
 */
export const showActionSheet: typeof ActionSheetIOS.showActionSheetWithOptions = (...args) => {
  if (Platform.OS === 'ios') return ActionSheetIOS.showActionSheetWithOptions(...args);
  const [options, callback] = args;
  openDialog(sheetRequest(options, callback));
};
