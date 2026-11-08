import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets work at both localhost and the GitHub Pages repository URL.
  base: './',
  build: {
    outDir: 'dist',
  },
});
