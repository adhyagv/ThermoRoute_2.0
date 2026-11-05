import axios from 'axios';
import type { RouteRequest, OptimizeResponse } from '../types/api';
import { API_BASE_URL } from './apiBase';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

export const optimizeRouteApi = async (payload: RouteRequest): Promise<OptimizeResponse> => {
  const response = await api.post('/api/optimize', payload);
  return response.data as OptimizeResponse;
};

export const healthCheckApi = async () => {
  const response = await api.get('/api/health');
  return response.data;
};
