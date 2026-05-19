import plugin from 'tailwindcss/plugin.js';

/** @type {import('tailwindcss').Config} */
// por quê: variante compatível com `data-theme` no `<html>` (não usar `prefers-color-scheme`)
export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../packages/lib/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        'brand-bg': '#3e1f63',
        'brand-primary': '#19143A',
        'brand-accent': '#3e1f63', // This line already has the value #3e1f63
        'brand-muted': '#686868',
        'brand-muted2': '#828282',
        'brand-stroke': '#DDDDDD',
        // pixel-perfect login
        brand: {
          // Segmented control / principal (DEFAULT/light)
          DEFAULT: '#5c2f91',
          light: '#7243aa',
          selected: '#4b217a',
          // Paleta existente mantida para não quebrar classes atuais
          bg: '#0F0C26',
          primary: '#19143A',
          accent: '#5c2f91',
          stroke: '#E2E2E8',
          muted: '#828282'
        },
        primary: {
          DEFAULT: '#5c2f91',
          foreground: '#ffffff'
        },
        violet: {
          600: '#5c2f91',
          700: '#4b217a'
        },
        purple: {
          25: '#fefcff',
          50: '#faf5ff',
          300: '#c4b5fd',
          400: '#a78bfa',
          600: '#7c3aed',
          900: '#581c87'
        }
      },
      boxShadow: {
        card: '0 8px 32px -4px rgba(10,10,15,0.18)'
      },
      borderRadius: {
        card: '40px'
      },
      keyframes: {
        'modal-expand-in': {
          from: { opacity: '0', transform: 'scale(0.82)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        'modal-shrink-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to:   { opacity: '0', transform: 'scale(0.82)' },
        },
      },
      animation: {
        'modal-expand-in':  'modal-expand-in 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'modal-shrink-out': 'modal-shrink-out 0.18s ease-in',
      },
    }
  },
  plugins: [
    plugin(function ({ addVariant }) {
      addVariant('alusa-dark', 'html[data-theme="dark"] &')
    }),
  ],
};
