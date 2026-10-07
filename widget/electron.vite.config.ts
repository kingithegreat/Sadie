import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const prepare = createRequire(resolve(__dirname, 'package.json'))('./scripts/prepare-windows-job.cjs') as {
  prepareWindowsJob(): { assembly: string; assemblySha256: string; sourceSha256: string; preparationSha256: string } | undefined
}

// Distribution builds fold development/test branches; CI's normal builds keep
// runtime NODE_ENV so their opt-in Electron fixtures still exercise the app.
const releaseDefines = process.env.HOMEBOT_RELEASE_BUILD === '1'
  ? { 'process.env.NODE_ENV': JSON.stringify('production') }
  : undefined

export default defineConfig(() => {
const managedJob = prepare.prepareWindowsJob()
return {
  main: {
    define: { ...releaseDefines, HOMEBOT_WINDOWS_JOB_ASSET_IDENTITY: JSON.stringify('HOMEBOT_OWNED_WINDOWS_JOB_ASSET_V1:' + (managedJob?.assemblySha256 || '')) },
    plugins: [externalizeDepsPlugin(), {
      name: 'homebot-managed-windows-job',
      buildStart() {
        if (managedJob) {
          const managedSource = resolve(__dirname, 'native/OwnedWindowsJob.cs')
          const preparationSource = resolve(__dirname, 'scripts/prepare-windows-job.cjs')
          this.addWatchFile(managedSource)
          this.addWatchFile(preparationSource)
          // The define pins the configuration's captured assembly. Regenerating
          // only the DLL during watch would pair new bytes with the old hash.
          if (createHash('sha256').update(readFileSync(managedSource)).digest('hex') !== managedJob.sourceSha256 || createHash('sha256').update(readFileSync(preparationSource)).digest('hex') !== managedJob.preparationSha256) throw new Error('Managed Job build inputs changed. Restart electron-vite dev to regenerate the asset and its pinned build identity.')
          const bytes = readFileSync(managedJob.assembly)
          if (createHash('sha256').update(bytes).digest('hex') !== managedJob.assemblySha256) throw new Error('Prepared managed Job asset changed before bundle emission.')
          this.emitFile({ type: 'asset', fileName: 'assets/OwnedWindowsJob.dll', source: bytes })
        }
      }
    }],
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
}
})
