export interface Point2D {
  x: number;
  z: number;
}

export interface WallSegment {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number; // meters, e.g. 2.8
  thickness: number; // meters, e.g. 0.18
  isExterior?: boolean;
  color?: string;
}

export interface DoorOpening {
  id: string;
  x: number;
  z: number;
  width: number; // meters, e.g. 0.9
  height: number; // meters, e.g. 2.1
  angle: number; // degrees
  swing?: 'left' | 'right';
}

export interface WindowOpening {
  id: string;
  x: number;
  z: number;
  width: number; // meters, e.g. 1.6
  height: number; // meters, e.g. 1.4
  sillHeight: number; // meters, e.g. 0.85
  angle: number; // degrees
}

export interface RoomZone {
  id: string;
  name: string;
  polygon: Point2D[];
  floorColor?: string;
  floorType?: 'concrete' | 'wood' | 'tile' | 'carpet';
}

export type EquipmentKind =
  | 'desk'
  | 'triangular_desk'
  | 'conference_table'
  | 'chair'
  | 'office_chair'
  | 'sofa_3'
  | 'sofa_2'
  | 'armchair'
  | 'coffee_table'
  | 'shelves'
  | 'sink'
  | 'toilet'
  | 'ac_unit'
  | 'bed'
  | 'plant';

export interface EquipmentItem {
  id: string;
  kind: EquipmentKind;
  name: string;
  x: number; // meters
  z: number; // meters
  elevation: number; // cm above floor
  rotation: number; // degrees
  length: number; // cm
  width: number; // cm
  height: number; // cm
  locatedOutdoors?: boolean;
  seatType?: string;
  color?: string;
}

export interface SpaceAnnotation {
  id: string;
  text: string;
  x: number;
  z: number;
  y?: number;
}

export interface StairItem {
  id: string;
  x: number;
  z: number;
  width: number;
  length: number;
  rotation: number;
  steps: number;
}

export interface SpaceLevel {
  id: string;
  name: string;
  elevation: number; // meters
  floorHeight: number; // meters
  walls: WallSegment[];
  doors: DoorOpening[];
  windows: WindowOpening[];
  rooms: RoomZone[];
  equipment: EquipmentItem[];
  annotations: SpaceAnnotation[];
  stairs: StairItem[];
  underlayImageUrl?: string;
  underlayOpacity?: number;
  underlayScale?: number;
  underlayWidthMeters?: number;
  underlayHeightMeters?: number;
  underlayOffsetX?: number;
  underlayOffsetZ?: number;
}

export interface LayoutSettings {
  showGrid: boolean;
  showLowerFloor: boolean;
  snapToGrid: boolean;
  gridSize: number; // meters
  unit: 'sqft' | 'sqm';
  wallHeight: number;
  wallThickness: number;
}

export interface SpaceData {
  levels: SpaceLevel[];
  settings: LayoutSettings;
}

export interface SpaceRecord {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  description: string;
  status: 'live' | 'draft';
  locked: boolean;
  tags: string[];
  sqft: number;
  views: number;
  complexity: number;
  sizeKb: number;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geoRotation: number;
  geoScale: number;
  thumbnailUrl: string | null;
  sourceCadImageUrl: string | null;
  data: SpaceData;
  unpublishedData: SpaceData | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  description: string;
  environment: 'production' | 'staging';
  spaceCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  requestCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AiChatMessage {
  id: string;
  spaceId: string;
  role: 'user' | 'assistant';
  content: string;
  imageDataUrl?: string | null;
  appliedDesignUpdate: boolean;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  workspaceName: string;
  createdAt: string;
}

export interface AgentStepTrace {
  step: number;
  phase: string;
  tool?: string;
  detail: string;
  status: 'done' | 'warning';
}

export type SpatialEntityType =
  | 'sensor'
  | 'beacon'
  | 'asset'
  | 'hvac'
  | 'camera'
  | 'zone_occupancy';

export type SpatialEntityStatus = 'online' | 'warning' | 'offline';

export interface SpatialEntityRecord {
  id: string;
  spaceId: string;
  levelId: string;
  name: string;
  entityType: SpatialEntityType;
  status: SpatialEntityStatus;
  x: number;
  z: number;
  elevation: number;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}
