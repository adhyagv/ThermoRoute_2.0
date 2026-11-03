import { useCallback, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { optimizeRouteApi } from '../services/api';
import type { RouteRequest, OptimizeResponse } from '../types/api';

export function useOptimizeRoute() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setLoadingRoute = useAppStore((state) => state.setLoadingRoute);
  const setErrorMessage = useAppStore((state) => state.setErrorMessage);

  const optimizeRoute = useCallback(async (payload: RouteRequest): Promise<OptimizeResponse | null> => {
    setIsLoading(true);
    setLoadingRoute(true);
    setError(null);
    setErrorMessage(null);
    try {
      return await optimizeRouteApi(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to connect to the ThermoRoute backend.';
      setError(message);
      setErrorMessage(message);
      return null;
    } finally {
      setIsLoading(false);
      setLoadingRoute(false);
    }
  }, [setErrorMessage, setLoadingRoute]);

  const resetError = useCallback(() => {
    setError(null);
    setErrorMessage(null);
  }, [setErrorMessage]);

  return { optimizeRoute, isLoading, error, resetError };
}
