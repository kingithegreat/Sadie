import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppMode = 'chat' | 'n8n';

interface ModeStore {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  previousMode: AppMode | null;
}

export const useModeStore = create<ModeStore>()(
  persist(
    (set) => ({
      mode: 'chat',
      previousMode: null,
      setMode: (mode) => set((state) => ({
        mode,
        previousMode: state.mode,
      })),
    }),
    {
      name: 'sadie-mode-storage',
    }
  )
);