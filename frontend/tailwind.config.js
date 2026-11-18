// Colors come from CSS variables (src/styles/tokens.css), one set per theme, so every
// existing class (slate-*, indigo-*, emerald-*, ...) follows the light and dark themes.
// slate is the solder-mask neutral scale and indigo the gold-plated accent.
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
const PALETTES = [
  'slate', 'indigo', 'emerald', 'amber', 'red', 'rose', 'orange', 'lime', 'sky', 'cyan',
  'violet', 'fuchsia', 'teal', 'pink', 'yellow', 'green', 'blue',
]
const themed = (name) =>
  Object.fromEntries(SHADES.map((shade) => [shade, `rgb(var(--${name}-${shade}) / <alpha-value>)`]))

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      colors: {
        ...Object.fromEntries(PALETTES.map((name) => [name, themed(name)])),
        accent: themed('indigo'),
      },
      borderRadius: {
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.625rem',
        '3xl': '0.75rem',
      },
      boxShadow: {
        // A hairline lift instead of a coloured glow.
        glow: '0 1px 2px 0 rgb(0 0 0 / 0.12)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'pop-in': { from: { opacity: '0', transform: 'scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in': { from: { opacity: '0', transform: 'translateX(12px)' }, to: { opacity: '1', transform: 'none' } },
        current: { to: { strokeDashoffset: '-48' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out both',
        'pop-in': 'pop-in 0.14s ease-out both',
        'slide-in': 'slide-in 0.2s ease-out both',
        current: 'current 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
