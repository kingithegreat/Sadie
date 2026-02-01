import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      runWorkflow: (id: string, data: any) => Promise<any>
      runPsScript: (script: string, args?: any) => Promise<any>
    }
  }
}
