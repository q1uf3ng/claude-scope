/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'ct-bg': '#0d1117',
        'ct-surface': '#161b22',
        'ct-border': '#30363d',
        'ct-text': '#e6edf3',
        'ct-text-secondary': '#8b949e',
        'ct-accent': '#58a6ff',
        'ct-green': '#3fb950',
        'ct-red': '#f85149',
        'ct-orange': '#d29922',
        'ct-purple': '#bc8cff',
        'ct-opus': '#bc8cff',
        'ct-sonnet': '#58a6ff',
        'ct-haiku': '#3fb950',
      },
    },
  },
  plugins: [],
}
