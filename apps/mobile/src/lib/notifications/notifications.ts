import * as Notifications from 'expo-notifications';

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined';

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionState> {
  const permissions = await Notifications.getPermissionsAsync();
  return permissions.status;
}
