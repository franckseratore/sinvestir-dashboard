/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#0F2042',
        accent: '#C9A55C',
        'status-green': '#10B981',
        'status-orange': '#F59E0B',
        'status-red': '#F43F5E',
        'data-blue': '#3B82F6',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      backgroundColor: {
        canvas: '#FAFAF7',
      },
    },
  },
  plugins: [],
}
