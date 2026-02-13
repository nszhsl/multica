import { useAuthStore } from '../stores/auth'

// Backend API host — driven by RENDERER_VITE_API_URL env var (set in .env.production / .env.development)
const API_HOST = import.meta.env.RENDERER_VITE_API_URL || 'https://api.multica.ai'

/**
 * Fetch request wrapper for desktop app.
 * Attaches sid, device-id, and os-type headers automatically.
 */
export async function request<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const sid = useAuthStore.getState().sid
  const deviceIdHeader = await window.electronAPI.auth.getDeviceIdHeader()

  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'os-type': '3',
      ...(deviceIdHeader && { 'device-id': deviceIdHeader }),
      ...(sid && { sid }),
      ...options.headers,
    },
  }

  const response = await fetch(`${API_HOST}${url}`, config)

  let data: T
  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    data = await response.json()
  } else {
    const text = await response.text()
    data = { message: text || response.statusText } as T
  }

  if (!response.ok) {
    console.error('API Error:', {
      status: response.status,
      url,
      data,
    })
    throw new Error(
      (data as { errMsg?: string; message?: string })?.errMsg ||
        (data as { message?: string })?.message ||
        `Request failed with status ${response.status}`,
    )
  }

  return data
}

// GET request
export function get<T = unknown>(url: string, params?: Record<string, string | number | boolean>) {
  const filteredParams = params
    ? Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
      )
    : undefined
  const queryString =
    filteredParams && Object.keys(filteredParams).length > 0
      ? `?${new URLSearchParams(filteredParams as Record<string, string>).toString()}`
      : ''
  return request<T>(url + queryString, { method: 'GET' })
}

// POST request
export function post<T = unknown>(url: string, data?: unknown) {
  return request<T>(url, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
