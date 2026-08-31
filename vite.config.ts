import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      'import.meta.env.LLM_BASE_URL': JSON.stringify(env.LLM_BASE_URL || 'https://openrouter.ai/api/v1'),
      'import.meta.env.LLM_API_KEY': JSON.stringify(env.OPENROUTER_API_KEY || env.LLM_API_KEY || ''),
      'import.meta.env.LLM_MODEL': JSON.stringify(env.LLM_MODEL || 'inclusionai/ling-3.0-flash-fin:free'),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          dashboard: resolve(fileURLToPath(new URL('.', import.meta.url)), 'dashboard.html'),
          popup: resolve(fileURLToPath(new URL('.', import.meta.url)), 'popup.html'),
          background: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/background/index.ts'),
        },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
