import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // When running just the functions emulator, we can't rely on the hosting
    // emulator for rewrites. Instead, we'll proxy directly to the functions
    // emulator and rewrite the path. The VITE_FUNCTIONS_ORIGIN environment
    // variable tells us where the functions emulator is running.
    const functionsEmulator = process.env.VITE_FUNCTIONS_ORIGIN || 'http://127.0.0.1:5001/demo-no-project/us-central1';

    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
            '/api': {
              target: functionsEmulator,
              changeOrigin: true,
              // Rewrite /api/functionName to /functionName
              rewrite: (path) => path.replace(/^\/api/, ''),
            }
          }
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
