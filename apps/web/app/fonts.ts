import localFont from 'next/font/local';

export const inter = localFont({
  src: './fonts/InterVariable.woff2',
  display: 'swap',
  variable: '--font-inter',
  weight: '100 900',
});

export const spaceMono = localFont({
  src: './fonts/SpaceMono-Regular.ttf',
  weight: '400',
  display: 'swap',
  variable: '--font-space-mono',
  preload: false,
});
