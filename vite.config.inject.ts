import { defineConfig } from 'vite'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Builds the MAIN-world page-injected script as a self-contained IIFE.
// It does NOT use React, Tailwind, or any chrome.* APIs (it runs in the page).
export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(__dirname, 'src') },
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    },
    build: {
        outDir: 'dist/js',
        emptyOutDir: false,
        sourcemap: process.env.NODE_ENV !== 'production' ? 'inline' : false,
        lib: {
            entry: path.resolve(__dirname, 'src/content-scripts/youtube/inject.ts'),
            name: 'adskipInject',
            formats: ['iife'],
        },
        rollupOptions: {
            output: {
                entryFileNames: 'inject.js',
                extend: true,
            },
        },
    },
})
