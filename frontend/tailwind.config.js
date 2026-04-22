/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      animation: {
        'fade-in':    'fadeIn 0.35s ease both',
        'slide-up':   'slideUp 0.4s ease both',
        'slide-down': 'slideDown 0.25s ease both',
        'slide-in':   'slideIn 0.3s ease both',
        'scale-in':   'scaleIn 0.25s ease both',
        'float':      'float 4s ease-in-out infinite',
        'glow':       'glow 3s ease-in-out infinite',
        'count-up':   'countUp 0.5s ease both',
        'pulse-dot':  'pulseDot 2s ease-in-out infinite',
        'shimmer':    'shimmer 1.6s infinite',
        'spin-slow':  'spin 2s linear infinite',
        'border-flow':'borderFlow 6s ease infinite',
      },
      keyframes: {
        fadeIn:     { from: { opacity: '0', transform: 'translateY(6px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        slideUp:    { from: { opacity: '0', transform: 'translateY(20px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideDown:  { from: { opacity: '0', transform: 'translateY(-8px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn:    { from: { opacity: '0', transform: 'translateX(-12px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        scaleIn:    { from: { opacity: '0', transform: 'scale(0.94)' },       to: { opacity: '1', transform: 'scale(1)' } },
        float:      { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        glow:       { '0%,100%': { boxShadow: '0 0 20px rgba(59,130,246,0.1)' }, '50%': { boxShadow: '0 0 40px rgba(59,130,246,0.25)' } },
        countUp:    { from: { opacity: '0', transform: 'translateY(10px) scale(0.9)' }, to: { opacity: '1', transform: 'none' } },
        pulseDot:   { '0%,100%': { opacity: '1', transform: 'scale(1)' }, '50%': { opacity: '0.5', transform: 'scale(0.85)' } },
        shimmer:    { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        borderFlow: { '0%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' }, '100%': { backgroundPosition: '0% 50%' } },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
};