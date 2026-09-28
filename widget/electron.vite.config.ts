import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Distribution builds fold development/test branches; CI's normal builds keep
// runtime NODE_ENV so their opt-in Electron fixtures still exercise the app.
const releaseDefines = process.env.HOMEBOT_RELEASE_BUILD === '1'
  ? { 'process.env.NODE_ENV': JSON.stringify('production') }
  : undefined

export default defineConfig({
  main: {
    define: releaseDefines,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    define: releaseDefines,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          webview: resolve(__dirname, 'src/preload/webview.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      target: 'chrome120',
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-hljs': ['highlight.js']
          }
        }
      }
    }
  }
})
