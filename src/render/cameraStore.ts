// Decouples the camera viewport from React so non-React sim systems can read
// it. Initial 0×0 dims signal "viewport not ready" until Game.tsx's
// ResizeObserver fires.

import { create } from 'zustand'

interface CameraState {
  canvasW: number
  canvasH: number
  camX: number
  camY: number
  setCamera: (next: { canvasW: number; canvasH: number; camX: number; camY: number }) => void
}

export const useCamera = create<CameraState>((set) => ({
  canvasW: 0,
  canvasH: 0,
  camX: 0,
  camY: 0,
  setCamera: (next) => set((prev) =>
    prev.canvasW === next.canvasW && prev.canvasH === next.canvasH
      && prev.camX === next.camX && prev.camY === next.camY
      ? prev
      : next,
  ),
}))
