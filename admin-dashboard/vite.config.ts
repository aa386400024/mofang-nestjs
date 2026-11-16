import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: [
        'vue',
        {
          'naive-ui': ['useMessage', 'useDialog', 'useNotification', 'useLoadingBar'],
        },
      ],
    }),
    Components({
      resolvers: [NaiveUiResolver()],
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5174,
    proxy: {
      '/admin/api': { target: 'http://localhost:3000', changeOrigin: true },
      // 只代理 WS 握手路径，必须与页面路由 /auto-practice 分开：
      // 否则 Vite 会把 GET /auto-practice 也转给后端，页面直接 404（Cannot GET /auto-practice）。
      '/ws/auto-practice': { target: 'http://localhost:3000', changeOrigin: true, ws: true },
    },
  },
})
