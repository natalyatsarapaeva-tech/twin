import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Ядро импортируется и воркером, и SPA: счётчик слов на экране и проверка
      // длины на сервере обязаны быть одной функцией (критерий приёмки 12).
      '@perimetr/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // В разработке фронт и воркер живут на одном домене (§4.1) — прокси это имитирует.
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
});
