import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
  const isSingle = mode === 'singlefile';
  return {
    plugins: [
      react(),
      ...(isSingle ? [viteSingleFile()] : [])
    ],
    build: {
      outDir: isSingle ? 'dist-single' : 'dist'
    }
  };
});
