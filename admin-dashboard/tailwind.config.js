/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0f1115',
          surface: '#161922',
          elevated: '#1e222d',
          border: '#2a2f3d',
        },
        accent: {
          DEFAULT: '#c890a8',
          soft: '#e8c8d4',
          muted: '#8a6078',
        },
        ok: '#7ec9a0',
        warn: '#e8c87a',
        danger: '#e87a7a',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
