import localFont from 'next/font/local';
import { Space_Mono } from 'next/font/google';

export const inter = localFont({
  src: './fonts/InterVariable.woff2',
  display: 'swap',
  variable: '--font-inter',
  weight: '100 900',
});

export const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-space-mono',
});
