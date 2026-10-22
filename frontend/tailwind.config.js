/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── CloudThat OFFICIAL brand palette (Brand Manual 2024) ──
        // Primary A = Dark Blue #20629b · Primary B = Coral Blue #1995ff
        // Primary C = Light Grey #fafafd. Primary actions, nav, headings.
        primary: {
          50: '#eef5fc',
          100: '#d4e6f6',
          200: '#a9ccec',
          300: '#71acdd',
          400: '#3f8bcb',
          500: '#20629b', // Dark Blue — Primary Color A
          600: '#1b5386',
          700: '#17426b',
          800: '#123353',
          900: '#0e283f',
          950: '#091a2a',
        },
        // Coral Blue — Primary Color B (bright accent, links, highlights).
        coral: {
          50: '#e8f3ff',
          100: '#cfe7ff',
          200: '#9cceff',
          300: '#63b2ff',
          400: '#1995ff', // Coral Blue — Primary Color B
          500: '#0f7fe6',
          600: '#0a66bd',
          700: '#084e91',
          800: '#063a6c',
          900: '#04294c',
        },
        // Deep navy — dark surfaces / hero backgrounds.
        navy: {
          50: '#e9edf5',
          100: '#c7d2e6',
          200: '#93a6c9',
          300: '#5f7aad',
          400: '#2f4d84',
          500: '#13316a',
          600: '#0d2b5e',
          700: '#0a224b',
          800: '#071a3a',
          900: '#05122a',
        },
        // Secondary system colors (Brand Manual page 13).
        accent: {
          red: '#f15645',
          gold: '#d0b92b',
          teal: '#009ba7',
          orange: '#c26437',
        },
        // Neutral grays — Light Grey #fafafd surface + text tones.
        dark: {
          50: '#fafafd',  // Primary Color C — Light Grey
          100: '#eef1f5',
          200: '#dfe4ea',
          300: '#c3ccd6',
          400: '#97a4b2',
          500: '#6b7987',
          600: '#4e5a67',
          700: '#374151',
          800: '#1f2a37',
          900: '#141b26',
          950: '#0b1017',
        },
        ai: {
          400: '#3f8bcb',
          500: '#20629b',
          600: '#1b5386',
        },
        success: '#009ba7', // brand teal
        warning: '#d0b92b', // brand gold
        danger: '#f15645',  // brand red
        info: '#1995ff',    // coral blue
      },
      fontFamily: {
        // Proxima Nova = CloudThat brand typeface (Brand Manual). It's a paid
        // font; when licensed font files are added it is used, otherwise we
        // fall back to Montserrat (closest free geometric-humanist lookalike).
        sans: ['"Proxima Nova"', 'Montserrat', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(16, 33, 60, 0.06), 0 1px 2px rgba(16, 33, 60, 0.04)',
        'card-hover': '0 4px 12px rgba(16, 33, 60, 0.10)',
      },
    },
  },
  plugins: [],
};
