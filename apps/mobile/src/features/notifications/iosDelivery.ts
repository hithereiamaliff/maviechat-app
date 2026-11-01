import type { NotificationPermissionsStatus } from 'expo-notifications';

// Apple's values as expo-notifications reports them: UNAuthorizationStatus .denied and .provisional, UNAlertStyle.none.
const DENIED = 1;
const PROVISIONAL = 3;
const NO_BANNERS = 0;

/**
 * What in iOS's own settings for MavieChat keeps a notification from showing as a banner,
 * or null when nothing does. A Focus such as Do Not Disturb can't be read, so it isn't covered.
 */
export function deliveryProblem(ios: NotificationPermissionsStatus['ios']): string | null {
  if (!ios) return null;
  if (Number(ios.status) === DENIED) return 'Notifications are off for MavieChat in iOS Settings.';
  if (Number(ios.status) === PROVISIONAL) return 'iOS delivers MavieChat notifications quietly, to Notification Center only.';
  if (ios.allowsAlert === false) return 'iOS is set not to show MavieChat notifications on screen.';
  if (Number(ios.alertStyle) === NO_BANNERS) return 'Banners are off for MavieChat in iOS Settings, so notifications only collect in Notification Center.';
  return null;
}
