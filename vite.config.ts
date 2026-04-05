import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// さくら用ビルド時にリダイレクトスクリプトを挿入するプラグイン
function redirectPlugin(): Plugin {
  const redirectUrl = process.env.VITE_REDIRECT;
  const redirectDate = process.env.VITE_REDIRECT_DATE;
  if (!redirectUrl || !redirectDate) return { name: 'no-redirect' };

  return {
    name: 'redirect-inject',
    transformIndexHtml(html) {
      const script = `<script>if(new Date()>=new Date('${redirectDate}'))location.replace('${redirectUrl}');</script>`;
      return html.replace('</head>', script + '</head>');
    },
  };
}

// https://vite.dev/config/
// VITE_BASE: GitHub Pages='/kamisama/' さくら='./'
export default defineConfig({
  plugins: [react(), redirectPlugin()],
  base: process.env.VITE_BASE ?? '/kamisama/',
})
