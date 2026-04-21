/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
  "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
],
  theme: {
    extend: {
      fontFamily: {
        // This links Tailwind's 'font-mono' to the Fira Code font variable from Next.js
        mono: ['var(--font-fira-code)', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        // Adding your premium slate palette for easier use in components
        slate: {
          950: '#0f172a',
          900: '#0a0f2e',
          800: '#1e293b',
        },
      },
    },
  },
  plugins: [],
};
