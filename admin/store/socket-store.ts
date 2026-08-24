import { create } from "zustand"

type SocketState = {
  isConnected: boolean
  setConnected: (isConnected: boolean) => void
}

export const useSocketStore = create<SocketState>((set) => ({
  isConnected: false,
  setConnected: (isConnected) => set({ isConnected }),
}))
