/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--primary)",
        "on-primary": "var(--on-primary)",
        "primary-container": "var(--primary-container)",
        "on-primary-container": "var(--on-primary-container)",
        surface: "var(--surface)",
        "surface-dim": "var(--surface-dim)",
        "surface-container": "var(--surface-container)",
        "surface-container-low": "var(--surface-container-low)",
        "surface-container-high": "var(--surface-container-high)",
        "surface-container-highest": "var(--surface-container-highest)",
        "on-surface": "var(--on-surface)",
        "on-surface-variant": "var(--on-surface-variant)",
        outline: "var(--outline)",
        "outline-variant": "var(--outline-variant)",
        error: "var(--error)",
        "error-container": "var(--error-container)",
      },
      borderRadius: {
        card: "var(--radius-card)",
        btn: "var(--radius-btn)",
        field: "var(--radius-field)",
      },
    },
  },
  plugins: [],
};
