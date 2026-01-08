import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const emulator = env.VITE_FUNCTIONS_EMULATOR;
    const project = env.VITE_FUNCTIONS_PROJECT;
    const shouldProxy = emulator || project;

    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: shouldProxy
          ? {
              // Forward client /api/* calls to the Functions emulator or project-specific path
              '/api': {
                target: emulator || 'http://127.0.0.1:5001',
                changeOrigin: true,
                rewrite: (p) => {
                  // If a project id is provided, rewrite to the emulator path that includes the project and region
                  if (project && !(emulator && emulator.includes(project))) {
                    return p.replace(/^\/api/, `/${project}/us-central1`);
                  }
                  return p.replace(/^\/api/, '');
                }
              }
            }
          : undefined
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
