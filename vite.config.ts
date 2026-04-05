import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// VITE_BASE: GitHub Pages='/kamisama/' さくら='./'
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/kamisama/',
})
