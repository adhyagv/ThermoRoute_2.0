import { create } from 'zustand';

type AppState = {
  loadingRoute: boolean;
  errorMessage: string | null;
  setLoadingRoute: (loading: boolean) => void;
  setErrorMessage: (message: string | null) => void;
};

export const useAppStore = create<AppState>((set) => ({
  loadingRoute: false,
  errorMessage: null,
  setLoadingRoute: (loadingRoute) => set({ loadingRoute }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
}));
