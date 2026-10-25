import { defineConfig } from 'vite';

export default defineConfig({
  // 静态托管（itch.io / GitHub Pages 子路径）必须用相对路径
  base: './',
  server: { port: 5173, host: '127.0.0.1', open: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    // Phaser 单包约 1.2MB，属正常体积
    chunkSizeWarningLimit: 2000,
  },
});
