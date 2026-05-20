/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Inter', 'ui-sans-serif', 'sans-serif']
      },
      colors: {
        alusa: {
          purple: '#5c2f91',
          'purple-hover': '#4b217a',
          'purple-dark': '#430D88',
          'purple-deeper': '#0F0C26',
          'purple-muted': '#686868',
          'purple-tint': '#f4f2ff',
          'grid-line-light': 'rgba(31, 18, 102, 0.2)'
        }
      },
      boxShadow: {
        soft: '0 20px 50px rgba(20, 10, 61, 0.08)',
        line: 'inset 0 0 0 1px rgba(31, 18, 102, 0.1)',
        'charges-preview':
          'rgba(0, 0, 0, 0.07) 0px 1px 1px, rgba(0, 0, 0, 0.07) 0px 2px 2px, rgba(0, 0, 0, 0.07) 0px 4px 4px, rgba(0, 0, 0, 0.07) 0px 8px 8px, rgba(0, 0, 0, 0.07) 0px 16px 16px'
      },
      spacing: {
        section: '5.5rem',
        'section-lg': '7rem'
      },
      keyframes: {
        'proof-strip': {
          from: { transform: 'translate3d(0, 0, 0)' },
          to: { transform: 'translate3d(-50%, 0, 0)' }
        }
      },
      animation: {
        'proof-strip': 'proof-strip 40s linear infinite'
      }
    }
  },
  plugins: []
};
