import * as THREE from 'three';
import type {
  SpaceData,
  SpaceLevel,
  WallSegment,
  DoorOpening,
  WindowOpening,
  EquipmentItem,
} from '../types/space.ts';

export interface BuiltEquipmentRef {
  id: string;
  group: THREE.Group;
  hitBox: THREE.Mesh;
  item: EquipmentItem;
}

export interface BuiltSpaceResult {
  root: THREE.Group;
  equipmentRefs: BuiltEquipmentRef[];
  boundingBox: THREE.Box3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  dispose: () => void;
}

function pointToSegmentDist(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): { dist: number; t: number } {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return { dist: Math.hypot(px - x1, pz - z1), t: 0 };
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  const projX = x1 + t * dx;
  const projZ = z1 + t * dz;
  return { dist: Math.hypot(px - projX, pz - projZ), t };
}

function createEquipmentGroup(
  item: EquipmentItem,
  isSelected: boolean
): THREE.Group {
  const group = new THREE.Group();
  group.name = `equipment:${item.id}`;

  const L = Math.max(0.2, item.length / 100);
  const W = Math.max(0.2, item.width / 100);
  const H = Math.max(0.15, item.height / 100);

  const primaryMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0xf5b062 : 0xf4f5f7,
    roughness: 0.55,
    metalness: 0.06,
  });
  const secondaryMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0xe08d38 : 0xdbe0e6,
    roughness: 0.68,
    metalness: 0.08,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0xd97706 : 0x9aa3af,
    roughness: 0.3,
    metalness: 0.72,
  });
  const darkAccentMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.35,
    metalness: 0.4,
  });

  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  switch (item.kind) {
    case 'triangular_desk': {
      // Hexagonal / triangular cluster desk like Screenshot 4
      const topGeo = new THREE.CylinderGeometry(L * 0.56, L * 0.56, 0.04, 6);
      const top = new THREE.Mesh(topGeo, primaryMat);
      top.position.set(0, H - 0.02, 0);
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);

      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.1, H - 0.04, 12),
        metalMat
      );
      col.position.set(0, (H - 0.04) / 2, 0);
      col.castShadow = true;
      group.add(col);

      // Divider fin & monitor
      addBox(L * 0.65, 0.28, 0.025, 0, H + 0.14, 0, secondaryMat);
      addBox(0.38, 0.24, 0.02, 0, H + 0.18, 0.18, darkAccentMat);
      break;
    }
    case 'conference_table': {
      const top = addBox(L, 0.045, W, 0, H - 0.022, 0, primaryMat);
      top.receiveShadow = true;
      addBox(0.14, H - 0.045, W * 0.45, -L * 0.3, (H - 0.045) / 2, 0, metalMat);
      addBox(0.14, H - 0.045, W * 0.45, L * 0.3, (H - 0.045) / 2, 0, metalMat);
      addBox(L * 0.45, 0.03, 0.08, 0, 0.015, 0, metalMat);
      break;
    }
    case 'desk': {
      addBox(L, 0.04, W, 0, H - 0.02, 0, primaryMat);
      const legH = H - 0.04;
      const lx = L / 2 - 0.04;
      const lz = W / 2 - 0.04;
      addBox(0.04, legH, 0.04, -lx, legH / 2, -lz, metalMat);
      addBox(0.04, legH, 0.04, lx, legH / 2, -lz, metalMat);
      addBox(0.04, legH, 0.04, -lx, legH / 2, lz, metalMat);
      addBox(0.04, legH, 0.04, lx, legH / 2, lz, metalMat);
      // Monitor on desk
      addBox(0.45, 0.28, 0.02, 0, H + 0.22, -W * 0.22, darkAccentMat);
      addBox(0.06, 0.1, 0.06, 0, H + 0.05, -W * 0.22, metalMat);
      break;
    }
    case 'chair':
    case 'office_chair': {
      const seatY = H * 0.52;
      addBox(L, 0.06, W, 0, seatY, 0, primaryMat);
      addBox(L * 0.92, H * 0.46, 0.06, 0, seatY + H * 0.23, -W / 2 + 0.03, secondaryMat);
      if (item.kind === 'office_chair') {
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.028, 0.028, seatY - 0.04, 10),
          metalMat
        );
        stem.position.set(0, (seatY - 0.04) / 2 + 0.03, 0);
        group.add(stem);
        addBox(L * 0.85, 0.03, 0.05, 0, 0.02, 0, metalMat);
        addBox(0.05, 0.03, W * 0.85, 0, 0.02, 0, metalMat);
        // Armrests
        addBox(0.04, 0.16, W * 0.6, -L / 2 + 0.02, seatY + 0.1, 0, metalMat);
        addBox(0.04, 0.16, W * 0.6, L / 2 - 0.02, seatY + 0.1, 0, metalMat);
      } else {
        const legH = seatY - 0.03;
        addBox(0.035, legH, 0.035, -L / 2 + 0.03, legH / 2, -W / 2 + 0.03, metalMat);
        addBox(0.035, legH, 0.035, L / 2 - 0.03, legH / 2, -W / 2 + 0.03, metalMat);
        addBox(0.035, legH, 0.035, -L / 2 + 0.03, legH / 2, W / 2 - 0.03, metalMat);
        addBox(0.035, legH, 0.035, L / 2 - 0.03, legH / 2, W / 2 - 0.03, metalMat);
      }
      break;
    }
    case 'sofa_3':
    case 'sofa_2':
    case 'armchair': {
      const seatH = H * 0.45;
      addBox(L, 0.14, W, 0, 0.1, 0, secondaryMat); // plinth
      addBox(L - 0.24, 0.16, W - 0.12, 0, seatH - 0.08, 0.05, primaryMat); // seat cushions
      addBox(L, H * 0.55, 0.18, 0, seatH + H * 0.24, -W / 2 + 0.09, secondaryMat); // backrest
      addBox(0.14, H * 0.42, W, -L / 2 + 0.07, H * 0.34, 0, secondaryMat); // left arm
      addBox(0.14, H * 0.42, W, L / 2 - 0.07, H * 0.34, 0, secondaryMat); // right arm
      break;
    }
    case 'coffee_table': {
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(L / 2, L / 2, 0.04, 24),
        primaryMat
      );
      top.position.set(0, H - 0.02, 0);
      top.scale.set(1, 1, W / L);
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.16, H - 0.04, 16),
        metalMat
      );
      base.position.set(0, (H - 0.04) / 2, 0);
      base.castShadow = true;
      group.add(base);
      break;
    }
    case 'shelves': {
      const sideT = 0.03;
      addBox(sideT, H, W, -L / 2 + sideT / 2, H / 2, 0, secondaryMat);
      addBox(sideT, H, W, L / 2 - sideT / 2, H / 2, 0, secondaryMat);
      addBox(L, H, 0.02, 0, H / 2, -W / 2 + 0.01, secondaryMat);
      const tiers = 5;
      for (let i = 0; i < tiers; i++) {
        const sy = 0.05 + (i * (H - 0.08)) / (tiers - 1);
        addBox(L - sideT * 2, 0.025, W - 0.02, 0, sy, 0, primaryMat);
      }
      break;
    }
    case 'sink': {
      addBox(L, H * 0.85, W, 0, H * 0.425, 0, primaryMat);
      addBox(L * 0.72, 0.06, W * 0.65, 0, H * 0.86, 0.02, secondaryMat);
      addBox(0.04, 0.18, 0.04, 0, H * 0.94, -W * 0.32, metalMat);
      addBox(0.03, 0.03, 0.12, 0, H * 1.02, -W * 0.26, metalMat);
      break;
    }
    case 'toilet': {
      addBox(L * 0.75, H * 0.9, W * 0.32, 0, H * 0.45, -W * 0.32, primaryMat);
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(L * 0.38, L * 0.28, H * 0.5, 16),
        primaryMat
      );
      bowl.position.set(0, H * 0.25, W * 0.14);
      bowl.castShadow = true;
      group.add(bowl);
      break;
    }
    case 'ac_unit': {
      addBox(L, H, W, 0, H / 2, 0, primaryMat);
      addBox(L * 0.88, 0.03, 0.02, 0, 0.05, W / 2 + 0.005, darkAccentMat);
      break;
    }
    case 'bed': {
      addBox(L, H * 0.35, W, 0, H * 0.175, 0, secondaryMat);
      addBox(L * 0.96, H * 0.35, W * 0.94, 0, H * 0.45, 0.02, primaryMat);
      addBox(L, H, 0.08, 0, H / 2, -W / 2 + 0.04, secondaryMat);
      addBox(L * 0.38, 0.1, 0.36, -L * 0.23, H * 0.68, -W * 0.32, primaryMat);
      addBox(L * 0.38, 0.1, 0.36, L * 0.23, H * 0.68, -W * 0.32, primaryMat);
      break;
    }
    case 'plant': {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(L * 0.35, L * 0.25, H * 0.38, 12),
        secondaryMat
      );
      pot.position.set(0, H * 0.19, 0);
      pot.castShadow = true;
      group.add(pot);
      const leafMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0xf59e0b : 0x7c9a82,
        roughness: 0.75,
      });
      const foliage = new THREE.Mesh(
        new THREE.IcosahedronGeometry(L * 0.45, 1),
        leafMat
      );
      foliage.position.set(0, H * 0.68, 0);
      foliage.castShadow = true;
      group.add(foliage);
      break;
    }
  }

  // Selection orange wireframe bounding box matching Screenshot 4
  if (isSelected) {
    const boxGeo = new THREE.BoxGeometry(L + 0.14, H + 0.12, W + 0.14);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xea580c });
    const wireframe = new THREE.LineSegments(edges, lineMat);
    wireframe.position.set(0, (H + 0.12) / 2, 0);
    group.add(wireframe);

    // Corner indicator cubes
    const cornerMat = new THREE.MeshBasicMaterial({ color: 0xea580c });
    const cornerGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const hx = (L + 0.14) / 2;
    const hz = (W + 0.14) / 2;
    for (const sx of [-hx, hx]) {
      for (const sz of [-hz, hz]) {
        const c = new THREE.Mesh(cornerGeo, cornerMat);
        c.position.set(sx, H + 0.12, sz);
        group.add(c);
      }
    }
  }

  group.position.set(item.x, item.elevation / 100, item.z);
  group.rotation.y = (-item.rotation * Math.PI) / 180;

  return group;
}

function buildWallWithOpenings(
  wall: WallSegment,
  doors: DoorOpening[],
  windows: WindowOpening[],
  wallMat: THREE.Material,
  frameMat: THREE.Material,
  glassMat: THREE.Material,
  doorLeafMat: THREE.Material
): THREE.Group {
  const wallGroup = new THREE.Group();
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return wallGroup;

  const angleRad = Math.atan2(dz, dx);
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;
  wallGroup.position.set(cx, 0, cz);
  wallGroup.rotation.y = -angleRad;

  interface OpeningSpan {
    start: number;
    end: number;
    bottom: number;
    top: number;
    kind: 'door' | 'window';
    swing?: 'left' | 'right';
  }

  const spans: OpeningSpan[] = [];
  const halfLen = length / 2;

  for (const d of doors) {
    const { dist, t } = pointToSegmentDist(d.x, d.z, wall.x1, wall.z1, wall.x2, wall.z2);
    if (dist <= wall.thickness + 0.35 && t > 0.02 && t < 0.98) {
      const center = (t - 0.5) * length;
      spans.push({
        start: Math.max(-halfLen, center - d.width / 2),
        end: Math.min(halfLen, center + d.width / 2),
        bottom: 0,
        top: Math.min(wall.height - 0.1, d.height),
        kind: 'door',
        swing: d.swing,
      });
    }
  }

  for (const w of windows) {
    const { dist, t } = pointToSegmentDist(w.x, w.z, wall.x1, wall.z1, wall.x2, wall.z2);
    if (dist <= wall.thickness + 0.35 && t > 0.02 && t < 0.98) {
      const center = (t - 0.5) * length;
      spans.push({
        start: Math.max(-halfLen, center - w.width / 2),
        end: Math.min(halfLen, center + w.width / 2),
        bottom: w.sillHeight,
        top: Math.min(wall.height - 0.1, w.sillHeight + w.height),
        kind: 'window',
      });
    }
  }

  spans.sort((a, b) => a.start - b.start);

  let cursor = -halfLen;
  for (const span of spans) {
    if (span.start > cursor + 0.02) {
      const segLen = span.start - cursor;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(segLen, wall.height, wall.thickness),
        wallMat
      );
      m.position.set(cursor + segLen / 2, wall.height / 2, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      wallGroup.add(m);
    }

    const opLen = Math.max(0.1, span.end - Math.max(cursor, span.start));
    const opCenter = Math.max(cursor, span.start) + opLen / 2;

    // Sill wall below window
    if (span.bottom > 0.02) {
      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(opLen, span.bottom, wall.thickness),
        wallMat
      );
      sill.position.set(opCenter, span.bottom / 2, 0);
      sill.castShadow = true;
      sill.receiveShadow = true;
      wallGroup.add(sill);
    }

    // Lintel above door/window
    const lintelH = wall.height - span.top;
    if (lintelH > 0.02) {
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(opLen, lintelH, wall.thickness),
        wallMat
      );
      lintel.position.set(opCenter, span.top + lintelH / 2, 0);
      lintel.castShadow = true;
      lintel.receiveShadow = true;
      wallGroup.add(lintel);
    }

    const opH = span.top - span.bottom;
    if (span.kind === 'window') {
      // Translucent architectural glazing + slender mullion frame
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(opLen - 0.04, opH - 0.04, 0.025),
        glassMat
      );
      glass.position.set(opCenter, span.bottom + opH / 2, 0);
      wallGroup.add(glass);

      const frameTop = new THREE.Mesh(
        new THREE.BoxGeometry(opLen, 0.04, wall.thickness * 0.7),
        frameMat
      );
      frameTop.position.set(opCenter, span.top - 0.02, 0);
      wallGroup.add(frameTop);

      const frameBot = new THREE.Mesh(
        new THREE.BoxGeometry(opLen, 0.04, wall.thickness * 0.7),
        frameMat
      );
      frameBot.position.set(opCenter, span.bottom + 0.02, 0);
      wallGroup.add(frameBot);
    } else {
      // Door frame + subtly ajar door leaf
      const leafPivot = new THREE.Group();
      leafPivot.position.set(opCenter - opLen / 2 + 0.02, span.bottom, 0);
      leafPivot.rotation.y = span.swing === 'right' ? -0.42 : 0.42;
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(opLen - 0.04, opH - 0.02, 0.045),
        doorLeafMat
      );
      leaf.position.set((opLen - 0.04) / 2, opH / 2, 0);
      leaf.castShadow = true;
      leafPivot.add(leaf);
      wallGroup.add(leafPivot);
    }

    cursor = Math.max(cursor, span.end);
  }

  if (halfLen - cursor > 0.02) {
    const segLen = halfLen - cursor;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(segLen, wall.height, wall.thickness),
      wallMat
    );
    m.position.set(cursor + segLen / 2, wall.height / 2, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    wallGroup.add(m);
  }

  return wallGroup;
}

export function buildSpaceScene(
  data: SpaceData,
  selectedEquipmentId: string | null
): BuiltSpaceResult {
  const root = new THREE.Group();
  const equipmentRefs: BuiltEquipmentRef[] = [];

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf6f7f9,
    roughness: 0.72,
    metalness: 0.02,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xd0d7e0,
    roughness: 0.45,
    metalness: 0.25,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9bc0d6,
    roughness: 0.1,
    metalness: 0.15,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const doorLeafMat = new THREE.MeshStandardMaterial({
    color: 0xe6eaf0,
    roughness: 0.6,
    metalness: 0.04,
  });
  const slabMat = new THREE.MeshStandardMaterial({
    color: 0xe2e6eb,
    roughness: 0.85,
    metalness: 0.02,
  });

  const floorMaterials: Record<string, THREE.MeshStandardMaterial> = {
    concrete: new THREE.MeshStandardMaterial({ color: 0xe4e8ed, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xe7dfd3, roughness: 0.72 }),
    tile: new THREE.MeshStandardMaterial({ color: 0xeaeef2, roughness: 0.5 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0xdde3ea, roughness: 0.95 }),
  };

  data.levels.forEach((level: SpaceLevel, lvlIdx: number) => {
    const levelGroup = new THREE.Group();
    levelGroup.name = `level:${level.id}`;
    levelGroup.position.y = level.elevation || lvlIdx * 3.0;

    // Floor slab bounding box
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const w of level.walls) {
      minX = Math.min(minX, w.x1, w.x2);
      maxX = Math.max(maxX, w.x1, w.x2);
      minZ = Math.min(minZ, w.z1, w.z2);
      maxZ = Math.max(maxZ, w.z1, w.z2);
    }

    if (Number.isFinite(minX) && maxX > minX && maxZ > minZ) {
      const slabW = maxX - minX + 0.3;
      const slabD = maxZ - minZ + 0.3;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(slabW, 0.14, slabD),
        slabMat
      );
      slab.position.set((minX + maxX) / 2, -0.07, (minZ + maxZ) / 2);
      slab.receiveShadow = true;
      levelGroup.add(slab);
    }

    // Room floor zones
    for (const room of level.rooms) {
      if (room.polygon.length < 3) continue;
      const shape = new THREE.Shape();
      room.polygon.forEach((pt, idx) => {
        if (idx === 0) shape.moveTo(pt.x, -pt.z);
        else shape.lineTo(pt.x, -pt.z);
      });
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mat = floorMaterials[room.floorType || 'concrete'] || floorMaterials.concrete;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.015;
      mesh.receiveShadow = true;
      levelGroup.add(mesh);
    }

    // Walls with door & window cutouts
    for (const wall of level.walls) {
      const wGroup = buildWallWithOpenings(
        wall,
        level.doors,
        level.windows,
        wallMat,
        frameMat,
        glassMat,
        doorLeafMat
      );
      levelGroup.add(wGroup);
    }

    // Equipment 3D groups + invisible raycast hitbox
    for (const item of level.equipment) {
      const isSelected = item.id === selectedEquipmentId;
      const eqGroup = createEquipmentGroup(item, isSelected);
      const hitGeo = new THREE.BoxGeometry(
        Math.max(0.35, item.length / 100),
        Math.max(0.35, item.height / 100),
        Math.max(0.35, item.width / 100)
      );
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitBox = new THREE.Mesh(hitGeo, hitMat);
      hitBox.position.set(0, Math.max(0.35, item.height / 100) / 2, 0);
      hitBox.userData.equipmentId = item.id;
      eqGroup.add(hitBox);
      levelGroup.add(eqGroup);

      equipmentRefs.push({
        id: item.id,
        group: eqGroup,
        hitBox,
        item,
      });
    }

    root.add(levelGroup);
  });

  const boundingBox = new THREE.Box3().setFromObject(root);
  if (boundingBox.isEmpty()) {
    boundingBox.setFromCenterAndSize(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(10, 3, 10)
    );
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  boundingBox.getCenter(center);
  boundingBox.getSize(size);

  const dispose = () => {
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
      if ((obj as THREE.LineSegments).isLineSegments) {
        const line = obj as THREE.LineSegments;
        line.geometry?.dispose();
        if (Array.isArray(line.material)) {
          line.material.forEach((m) => m.dispose());
        } else {
          line.material?.dispose();
        }
      }
    });
  };

  return { root, equipmentRefs, boundingBox, center, size, dispose };
}
