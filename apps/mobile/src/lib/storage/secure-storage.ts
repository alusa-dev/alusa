import * as SecureStore from 'expo-secure-store';
import type { SecureStoreOptions } from 'expo-secure-store';
import { Platform } from 'react-native';

export type SecureStorage = {
  getItem(_key: string, _options?: SecureStoreOptions): Promise<string | null>;
  setItem(_key: string, _value: string, _options?: SecureStoreOptions): Promise<void>;
  deleteItem(_key: string, _options?: SecureStoreOptions): Promise<void>;
};

export const secureStorage: SecureStorage = {
  getItem: async (key, options) => {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key, options);
  },
  setItem: async (key, value, options) => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      ...options,
    });
  },
  deleteItem: async (key, options) => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key, options);
  },
};
