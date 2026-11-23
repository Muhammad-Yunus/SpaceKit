export interface SpaceKitConfig {
  spaceId: string;
  apiKey: string;
  /** Base REST endpoint URL, e.g. https://your-spacekit-host/api/v1 */
  endpoint?: string;
}

export interface SpaceKitViewerOptions {
  /** ID of the DOM element where the 3D/2D viewer should mount */
  containerId?: string;
  /** Direct DOM element reference (alternative to containerId) */
  containerElement?: HTMLElement;
  /** Initial camera projection mode */
  mode?: '3d' | '2d';
  /** Whether room labels and entity tags are visible initially */
  showAnnotations?: boolean;
  /** CSS width for mounted viewer iframe (defaults to '100%') */
  width?: string;
  /** CSS height for mounted viewer iframe (defaults to '100%') */
  height?: string;
}

export interface SpatialEntityInput {
  name: string;
  entityType?: 'sensor' | 'asset' | 'zone' | 'desk' | 'camera';
  status?: 'online' | 'warning' | 'offline';
  levelId?: string;
  x?: number;
  z?: number;
  elevation?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface SpatialEntityRecord {
  id: string;
  spaceId: string;
  levelId: string;
  name: string;
  entityType: string;
  status: string;
  x: number;
  z: number;
  elevation: number;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface SpacePayload {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'live' | string;
  metrics: {
    sqft: number;
    levels: number;
    complexity: number;
    sizeKb: number;
  };
  geospatial: {
    address: string;
    latitude: number;
    longitude: number;
    rotationDeg: number;
    scale: number;
  } | null;
  levels: unknown[];
  updatedAt: string;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
  }>;
}

export interface SpaceKitViewerController {
  iframe: HTMLIFrameElement;
  setMode: (mode: '2d' | '3d') => void;
  setAnnotations: (visible: boolean) => void;
  selectEntity: (entityId: string | null) => void;
  refreshEntities: () => Promise<SpatialEntityRecord[]>;
  onEntitySelect: (cb: (entityId: string | null) => void) => () => void;
  destroy: () => void;
}

function resolveOrigins(endpoint?: string): { apiBase: string; appOrigin: string } {
  let clean = (endpoint || '').trim().replace(/\/+$/, '');
  if (!clean && typeof window !== 'undefined' && window.location?.origin) {
    clean = `${window.location.origin}/api/v1`;
  }
  if (!clean) {
    throw new Error(
      'SpaceKit SDK: "endpoint" is required in non-browser environments (e.g. https://your-host/api/v1).'
    );
  }
  const apiBase = clean.endsWith('/api/v1') ? clean : `${clean}/api/v1`;
  let appOrigin = apiBase.replace(/\/api\/v1$/, '');
  try {
    appOrigin = new URL(apiBase).origin;
  } catch {
    // keep string origin fallback
  }
  return { apiBase, appOrigin };
}

export class SpaceKitSpace {
  public readonly spaceId: string;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly appOrigin: string;

  constructor(config: SpaceKitConfig) {
    if (!config?.spaceId) {
      throw new Error('SpaceKit SDK: "spaceId" is required.');
    }
    if (!config?.apiKey) {
      throw new Error('SpaceKit SDK: "apiKey" is required.');
    }
    this.spaceId = config.spaceId;
    this.apiKey = config.apiKey;
    const resolved = resolveOrigins(config.endpoint);
    this.apiBase = resolved.apiBase;
    this.appOrigin = resolved.appOrigin;
  }

  private async request<T>(subPath: string, init?: RequestInit): Promise<T> {
    const url = `${this.apiBase}/spaces/${encodeURIComponent(this.spaceId)}${subPath}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-spacekit-key': this.apiKey,
        ...(init?.headers || {}),
      },
    });
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`SpaceKit SDK HTTP ${res.status}: Invalid JSON response`);
    }
    if (!res.ok) {
      const errMsg =
        json && typeof json === 'object' && 'error' in json
          ? String((json as { error?: string }).error)
          : `HTTP ${res.status}`;
      throw new Error(`SpaceKit API error (${res.status}): ${errMsg}`);
    }
    return json as T;
  }

  /** Fetch building geometry, levels, walls, doors, windows, equipment, and geospatial placement */
  async getSpace(): Promise<SpacePayload> {
    return this.request<SpacePayload>('');
  }

  /** Fetch GeoJSON FeatureCollection of all polygon rooms in WGS84 coordinates */
  async getGeoJSON(): Promise<GeoJsonFeatureCollection> {
    return this.request<GeoJsonFeatureCollection>('/geo');
  }

  /** List spatial IoT/asset entities registered in this space */
  async listEntities(): Promise<{
    spaceId: string;
    count: number;
    entities: SpatialEntityRecord[];
  }> {
    return this.request('/entities');
  }

  /** Create a new spatial IoT/asset entity inside the space */
  async createEntity(
    input: SpatialEntityInput
  ): Promise<{ entity: SpatialEntityRecord }> {
    return this.request('/entities', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Update coordinates, status, or metadata of an existing entity */
  async updateEntity(
    entityId: string,
    patch: Partial<SpatialEntityInput>
  ): Promise<{ entity: SpatialEntityRecord }> {
    return this.request(`/entities/${encodeURIComponent(entityId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  /**
   * Authenticates via API key against /api/v1 and mounts the interactive Three.js 3D/2D viewer
   * into the target DOM container with live postMessage synchronization.
   */
  async startViewer(
    options: SpaceKitViewerOptions
  ): Promise<SpaceKitViewerController> {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      throw new Error('startViewer() can only run in a browser DOM environment.');
    }

    const container =
      options.containerElement ||
      (options.containerId ? document.getElementById(options.containerId) : null);

    if (!container) {
      throw new Error(
        `SpaceKit SDK: Target container "${options.containerId || 'element'}" not found in DOM.`
      );
    }

    const [spaceData, entityRes] = await Promise.all([
      this.getSpace(),
      this.listEntities().catch(() => ({
        spaceId: this.spaceId,
        count: 0,
        entities: [] as SpatialEntityRecord[],
      })),
    ]);

    const viewerSessionId = `skv_${Math.random().toString(36).slice(2, 10)}`;
    const mode = options.mode === '2d' ? '2d' : '3d';
    const showAnnotations = options.showAnnotations !== false;

    const iframe = document.createElement('iframe');
    const embedUrl = `${this.appOrigin}/?space=${encodeURIComponent(
      this.spaceId
    )}&embed=1&sdk=1&sid=${encodeURIComponent(viewerSessionId)}&mode=${mode}&annotations=${
      showAnnotations ? '1' : '0'
    }`;

    iframe.src = embedUrl;
    iframe.style.width = options.width || '100%';
    iframe.style.height = options.height || '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.allow = 'fullscreen';
    iframe.setAttribute('title', `SpaceKit 3D Viewer — ${spaceData.name}`);

    container.innerHTML = '';
    container.appendChild(iframe);

    const selectListeners = new Set<(entityId: string | null) => void>();

    const postToViewer = (payload: Record<string, unknown>) => {
      iframe.contentWindow?.postMessage(
        { ...payload, sid: viewerSessionId },
        this.appOrigin
      );
    };

    const hydrate = (entitiesList: SpatialEntityRecord[]) => {
      postToViewer({
        type: 'spacekit:hydrate',
        space: {
          id: spaceData.id,
          name: spaceData.name,
          description: spaceData.description,
          status: spaceData.status,
          sqft: spaceData.metrics?.sqft || 0,
          data: {
            levels: spaceData.levels || [],
            settings: {
              showGrid: true,
              showLowerFloor: false,
              snapToGrid: true,
              gridSize: 0.5,
              unit: 'sqft',
              wallHeight: 2.8,
              wallThickness: 0.16,
            },
          },
          updatedAt: spaceData.updatedAt,
        },
        entities: entitiesList,
        options: {
          mode,
          showAnnotations,
        },
      });
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow) return;
      const msg = ev.data as Record<string, unknown> | null;
      if (!msg || typeof msg !== 'object') return;
      if (msg.sid && msg.sid !== viewerSessionId) return;

      if (msg.type === 'spacekit:ready') {
        hydrate(entityRes.entities);
      } else if (msg.type === 'spacekit:entitySelected') {
        const entityId =
          typeof msg.entityId === 'string' ? msg.entityId : null;
        for (const cb of selectListeners) cb(entityId);
      }
    };

    window.addEventListener('message', onMessage);

    // Send hydration after load as fallback in case ready message fired early
    iframe.addEventListener('load', () => {
      hydrate(entityRes.entities);
    });

    return {
      iframe,
      setMode: (nextMode: '2d' | '3d') => {
        postToViewer({ type: 'spacekit:setOptions', mode: nextMode });
      },
      setAnnotations: (visible: boolean) => {
        postToViewer({ type: 'spacekit:setOptions', showAnnotations: visible });
      },
      selectEntity: (entityId: string | null) => {
        postToViewer({ type: 'spacekit:selectEntity', entityId });
      },
      refreshEntities: async () => {
        const latest = await this.listEntities();
        postToViewer({
          type: 'spacekit:setEntities',
          entities: latest.entities,
        });
        return latest.entities;
      },
      onEntitySelect: (cb: (entityId: string | null) => void) => {
        selectListeners.add(cb);
        return () => {
          selectListeners.delete(cb);
        };
      },
      destroy: () => {
        window.removeEventListener('message', onMessage);
        selectListeners.clear();
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      },
    };
  }
}

export const SpaceKit = {
  version: '1.0.0',
  Space: SpaceKitSpace,
} as const;

export default SpaceKit;
