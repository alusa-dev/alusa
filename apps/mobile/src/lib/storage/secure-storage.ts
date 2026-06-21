import * as SecureStore from 'expo-secure-store';

export type SecureStorage = {
  getItem(_key: string): Promise<string | null>;
  setItem(_key: string, _value: string): Promise<void>;
  deleteItem(_key: string): Promise<void>;
};

export const secureStorage: SecureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};
