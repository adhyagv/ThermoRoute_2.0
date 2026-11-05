const configuredApiBase = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '');

export const API_BASE_URL = configuredApiBase || (import.meta.env.DEV ? 'http://localhost:8000' : '');
