import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative base so the static build works from any GitHub Pages subpath.
  base: './',
  plugins: [react(), tailwindcss()],
});
