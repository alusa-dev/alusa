import { Platform } from 'react-native';

export const fontFamily = Platform.select({
  ios: {
    regular: 'System',
    medium: 'System',
    bold: 'System',
  },
  default: {
    regular: undefined,
    medium: undefined,
    bold: undefined,
  },
});
