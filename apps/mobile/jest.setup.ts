import * as React from 'react';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-router', () => {
  return {
    Redirect: ({ href }: { href: string }) => React.createElement('Redirect', { href }),
    Stack: Object.assign(({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children), {
      Screen: () => null,
      Protected: ({ guard, children }: { guard: boolean; children: React.ReactNode }) =>
        guard ? React.createElement(React.Fragment, null, children) : null,
    }),
    Tabs: Object.assign(({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children), {
      Screen: () => null,
    }),
  };
});
