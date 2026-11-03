/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ember: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c'
        },
        slate: {
          950: '#020817'
        }
      },
      boxShadow: {
        glow: '0 0 40px rgba(251, 146, 60, 0.35)'
      }
    }
  },
  plugins: []
};
