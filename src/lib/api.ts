import type {
  AuthUser,
  SpaceRecord,
  ProjectRecord,
  ApiKeyRecord,
  AiChatMessage,
  SpaceData,
  AgentStepTrace,
} from '../types/space.ts';

let memoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await res.json()
    : { error: await res.text() };

  if (!res.ok) {
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return payload as T;
}

export const api = {
  health: () =>
    apiFetch<{
      ok: boolean;
      dbConfigured: boolean;
      dbConnected: boolean;
      error?: string;
    }>('/api/health'),

  getMapsConfig: () => apiFetch<{ apiKey: string }>('/api/config/maps'),

  getAiConfig: () =>
    apiFetch<{
      configured: boolean;
      provider: 'openai-compatible' | 'gemini' | 'none';
      model: string | null;
      baseUrlHost: string | null;
    }>('/api/config/ai'),

  geocodeAddress: (q: string) =>
    apiFetch<{
      results: Array<{ formattedAddress: string; lat: number; lng: number }>;
    }>(`/api/maps/geocode?q=${encodeURIComponent(q)}`),

  register: (body: {
    email: string;
    password: string;
    name: string;
    workspaceName?: string;
  }) =>
    apiFetch<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => apiFetch<{ user: AuthUser }>('/api/auth/me'),

  listSpaces: () => apiFetch<{ spaces: SpaceRecord[] }>('/api/spaces'),

  createSpace: (body: {
    name: string;
    description?: string;
    projectId?: string | null;
    tags?: string[];
    data?: SpaceData;
    sqft?: number;
    thumbnailUrl?: string | null;
  }) =>
    apiFetch<{ space: SpaceRecord }>('/api/spaces', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSpace: (id: string) =>
    apiFetch<{ space: SpaceRecord }>(`/api/spaces/${encodeURIComponent(id)}`),

  updateSpace: (
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      locked: boolean;
      tags: string[];
      projectId: string | null;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      geoRotation: number;
      geoScale: number;
      thumbnailUrl: string | null;
      unpublishedData: SpaceData;
      data: SpaceData;
    }>
  ) =>
    apiFetch<{ space: SpaceRecord }>(`/api/spaces/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  publishSpace: (id: string) =>
    apiFetch<{ space: SpaceRecord }>(
      `/api/spaces/${encodeURIComponent(id)}/publish`,
      { method: 'POST' }
    ),

  discardSpace: (id: string) =>
    apiFetch<{ space: SpaceRecord }>(
      `/api/spaces/${encodeURIComponent(id)}/discard`,
      { method: 'POST' }
    ),

  deleteSpace: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/spaces/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listProjects: () => apiFetch<{ projects: ProjectRecord[] }>('/api/projects'),

  createProject: (body: {
    name: string;
    description?: string;
    environment?: 'production' | 'staging';
  }) =>
    apiFetch<{ project: ProjectRecord }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteProject: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listKeys: () => apiFetch<{ keys: ApiKeyRecord[] }>('/api/keys'),

  createKey: (name: string) =>
    apiFetch<{ rawKey: string; key: ApiKeyRecord }>('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  deleteKey: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getUsage: () =>
    apiFetch<{
      usage: {
        totalSpaces: number;
        totalSqft: number;
        totalViews: number;
        totalSizeKb: number;
        totalApiRequests: number;
        geolocatedSpaces: number;
        spacesBreakdown: Array<{
          id: string;
          name: string;
          sqft: number;
          views: number;
          complexity: number;
          sizeKb: number;
          levels: number;
          equipmentCount: number;
        }>;
      };
    }>('/api/usage'),

  cadTo3D: (formData: FormData) =>
    apiFetch<{
      space: SpaceRecord;
      summary: string;
      provider?: string;
      agentTrace?: AgentStepTrace[];
    }>('/api/ai/cad-to-3d', {
      method: 'POST',
      body: formData,
    }),

  getChat: (spaceId: string) =>
    apiFetch<{ messages: AiChatMessage[] }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/chat`
    ),

  sendChat: (formData: FormData) =>
    apiFetch<{
      userMessage: AiChatMessage;
      assistantMessage: AiChatMessage;
      appliedDesignUpdate: boolean;
      space: SpaceRecord;
      provider?: string;
      agentTrace?: AgentStepTrace[];
    }>('/api/ai/chat', {
      method: 'POST',
      body: formData,
    }),

  testSdkSpace: (spaceId: string, apiKey?: string) =>
    apiFetch<Record<string, unknown>>(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}`,
      apiKey ? { headers: { 'x-spacekit-key': apiKey } } : {}
    ),

  testSdkGeo: (spaceId: string, apiKey?: string) =>
    apiFetch<Record<string, unknown>>(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/geo`,
      apiKey ? { headers: { 'x-spacekit-key': apiKey } } : {}
    ),
};
