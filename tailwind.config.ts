import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#1c1b1a",
        paper: "#f6f4ef",
        line: "#e6e2d8",
      },
    },
  },
  plugins: [],
};

export default config;
