/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Tajawal', 'Segoe UI', 'Geeza Pro', 'Tahoma', 'sans-serif']
      },
      colors: {
        brand: {
          50: '#eef7ff', 100: '#d9edff', 200: '#bce0ff', 300: '#8ecdff',
          400: '#59b0ff', 500: '#2f8ff5', 600: '#1a70db', 700: '#165ab1',
          800: '#184d8f', 900: '#194272', 950: '#112a4a'
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)'
      }
    }
  },
  plugins: []
}
