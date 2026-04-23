/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx,html}'],
  theme: {
    extend: {
      colors: {
        sage: {
          50:  '#F3F5F0',
          100: '#E5EADF',
          200: '#C8D4BD',
          300: '#AEBFA0',
          400: '#94A886',
          500: '#7A9070',
          600: '#617558',
          700: '#4B5C45',
        },
        peach: {
          50:  '#FBF1EA',
          100: '#F6E0D0',
          200: '#EEC8AE',
          300: '#E3AD8B',
          400: '#D48E6C',
          500: '#BF7251',
        },
        cream: {
          50:  '#FAF6EF',
          100: '#F3ECE0',
          200: '#E8DDCB',
        },
        dusk: {
          100: '#D4B8A8',
          200: '#B89584',
          300: '#8E7569',
          400: '#6B554E',
          500: '#4A3A36',
        },
        ink: '#2A2A2E',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        display: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter:  '-0.025em',
        tight:    '-0.015em',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        'clay':    '0 10px 30px -12px rgba(75, 55, 45, 0.25), 0 2px 8px -2px rgba(75, 55, 45, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 0.5)',
        'clay-lg': '0 30px 60px -25px rgba(75, 55, 45, 0.3), 0 6px 20px -6px rgba(75, 55, 45, 0.1), inset 0 1px 0 0 rgba(255, 255, 255, 0.6)',
        'clay-inset': 'inset 0 4px 10px -4px rgba(75, 55, 45, 0.15), inset 0 -2px 6px -3px rgba(255, 255, 255, 0.8)',
        'glass':    '0 12px 40px -8px rgba(40, 30, 25, 0.22), inset 0 1px 0 0 rgba(255, 255, 255, 0.3)',
        'glass-lg': '0 24px 60px -12px rgba(40, 30, 25, 0.28), inset 0 1px 0 0 rgba(255, 255, 255, 0.35)',
      },
      backdropBlur: {
        'xs': '4px',
        '4xl': '72px',
      },
      backgroundImage: {
        'dusk-gradient': 'linear-gradient(180deg, #F6E0D0 0%, #D4B8A8 55%, #8E7569 100%)',
        'sage-gradient': 'linear-gradient(180deg, #E5EADF 0%, #C8D4BD 100%)',
        'sunset':        'linear-gradient(160deg, #F6E0D0 0%, #E3AD8B 45%, #B89584 80%, #8E7569 100%)',
      },
      keyframes: {
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%':      { transform: 'translateY(-8px) rotate(0.5deg)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'float-slow': 'float-slow 6s ease-in-out infinite',
        'fade-up':    'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};
