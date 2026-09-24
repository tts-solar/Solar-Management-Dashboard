/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: 'node',
  },
})
