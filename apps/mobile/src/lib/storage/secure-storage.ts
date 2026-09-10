import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type SecureStorage = {
  getItem(_key: string): Promise<string | null>;
  setItem(_key: string, _value: string): Promise<void>;
  deleteItem(_key: string): Promise<void>;
};

export const secureStorage: SecureStorage = {
  getItem: async (key) => {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key, value) => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  deleteItem: async (key) => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
