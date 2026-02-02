// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'widget/src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'widget/src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'widget', 'src', 'renderer'),
    plugins: [react()],
    // This alias allows the Widget to steal components from your Webapp
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared')
      }
    }
  }
})