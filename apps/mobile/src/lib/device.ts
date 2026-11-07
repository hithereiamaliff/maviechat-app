/**
 * Words for the device the app runs on. Expo fixes `process.env.EXPO_OS` when it bundles the
 * app, so this needs no React Native import; unit tests, which have no platform, get the iPhone's.
 */
export const ANDROID = process.env.EXPO_OS === 'android';

/** As in "this iPhone", or "this phone" on Android. */
export const DEVICE = ANDROID ? 'phone' : 'iPhone';

/** The system's settings app, as hints name it. */
export const SYSTEM_SETTINGS = ANDROID ? 'Android Settings' : 'iOS Settings';
