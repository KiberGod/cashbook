import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the project at /<repo-name>/
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/cashbook/' : '/',
  plugins: [react()],
  build: {
    // libraries live in their own chunks: they rarely change, so after a release the
    // browser keeps them cached and downloads only the app code
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
    // largest chunk (libraries) is ~410 kB minified; a little headroom over the 500 kB default
    chunkSizeWarningLimit: 600,
  },
}));
