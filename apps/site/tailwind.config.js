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
          'purple-dark': '#19143A',
          'purple-deeper': '#0F0C26',
          'purple-muted': '#686868',
          'purple-tint': '#f4f2ff'
        }
      },
      boxShadow: {
        soft: '0 20px 50px rgba(20, 10, 61, 0.08)',
        line: 'inset 0 0 0 1px rgba(31, 18, 102, 0.1)'
      },
      spacing: {
        section: '5.5rem',
        'section-lg': '7rem'
      }
    }
  },
  plugins: []
};
