import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Crosshair, Plus, Minus, Tag } from 'lucide-react';
import type { SpaceData, SpatialEntityRecord } from '../types/space.ts';
import {
  buildSpaceScene,
  type BuiltEquipmentRef,
  type BuiltEntityRef,
} from '../three/buildSpaceScene.ts';

interface Space3DViewerProps {
  data: SpaceData;
  entities?: SpatialEntityRecord[];
  selectedEquipmentId?: string | null;
  selectedEntityId?: string | null;
  onSelectEquipment?: (id: string | null) => void;
  onSelectEntity?: (id: string | null) => void;
  onMoveEquipment?: (id: string, x: number, z: number) => void;
  onPickFloorPoint?: (x: number, z: number) => void;
  interactiveEquipment?: boolean;
  showControlsToolbar?: boolean;
  compactPreview?: boolean;
  externalMode?: '2d' | '3d';
  externalShowAnnotations?: boolean;
  onSnapshotReady?: (captureFn: () => string | null) => void;
}

interface LabelProjection {
  id: string;
  text: string;
  x: number;
  y: number;
  visible: boolean;
  kind?: 'room' | 'entity';
  status?: string;
}

export const Space3DViewer: React.FC<Space3DViewerProps> = ({
  data,
  entities = [],
  selectedEquipmentId = null,
  selectedEntityId = null,
  onSelectEquipment,
  onSelectEntity,
  onMoveEquipment,
  onPickFloorPoint,
  interactiveEquipment = false,
  showControlsToolbar = true,
  compactPreview = false,
  externalMode,
  externalShowAnnotations,
  onSnapshotReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [is2D, setIs2D] = useState(externalMode === '2d');
  const [showAnnotations, setShowAnnotations] = useState(
    externalShowAnnotations !== undefined ? externalShowAnnotations : true
  );
  const [labels, setLabels] = useState<LabelProjection[]>([]);
  const [webglError, setWebglError] = useState<string | null>(null);

  const dataRef = useRef(data);
  dataRef.current = data;
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const selectedIdRef = useRef(selectedEquipmentId);
  selectedIdRef.current = selectedEquipmentId;
  const selectedEntityIdRef = useRef(selectedEntityId);
  selectedEntityIdRef.current = selectedEntityId;
  const showAnnotationsRef = useRef(showAnnotations);
  showAnnotationsRef.current = showAnnotations;
  const onSelectRef = useRef(onSelectEquipment);
  onSelectRef.current = onSelectEquipment;
  const onSelectEntityRef = useRef(onSelectEntity);
  onSelectEntityRef.current = onSelectEntity;
  const onMoveRef = useRef(onMoveEquipment);
  onMoveRef.current = onMoveEquipment;
  const onPickFloorRef = useRef(onPickFloorPoint);
  onPickFloorRef.current = onPickFloorPoint;
  const interactiveRef = useRef(interactiveEquipment);
  interactiveRef.current = interactiveEquipment;

  const cameraActionsRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    recenter: () => void;
    toggle2D: (to2D: boolean) => void;
    capture: () => string | null;
  } | null>(null);

  const rebuildSceneRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch {
      setWebglError('WebGL 3D context could not be initialized.');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfd7df);
    scene.fog = new THREE.Fog(0xcfd7df, 45, 130);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Calibrated architectural lighting matching Screenshots 1, 2, 4
    const hemiLight = new THREE.HemisphereLight(0xf8fafc, 0xcad3de, 0.92);
    hemiLight.position.set(0, 30, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffaf2, 1.15);
    keyLight.position.set(16, 26, 14);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 80;
    keyLight.shadow.camera.left = -22;
    keyLight.shadow.camera.right = 22;
    keyLight.shadow.camera.top = 22;
    keyLight.shadow.camera.bottom = -22;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xe0ecff, 0.45);
    rimLight.position.set(-14, 12, -16);
    scene.add(rimLight);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 200);
    camera.position.set(14, 15, 15);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 3;
    controls.maxDistance = 65;

    let currentBuilt: ReturnType<typeof buildSpaceScene> | null = null;
    let equipmentRefs: BuiltEquipmentRef[] = [];
    let entityRefs: BuiltEntityRef[] = [];
    let sceneCenter = new THREE.Vector3(0, 1, 0);
    let sceneRadius = 12;

    const projectVec = new THREE.Vector3();
    const updateAnnotations = () => {
      if (!showAnnotationsRef.current || compactPreview) {
        setLabels([]);
        return;
      }
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;

      const items: LabelProjection[] = [];
      const levels = dataRef.current.levels;
      if (levels.length === 0) {
        setLabels([]);
        return;
      }

      const sources: Array<{
        id: string;
        text: string;
        x: number;
        z: number;
        y: number;
        kind: 'room' | 'entity';
        status?: string;
      }> = [];

      levels.forEach((lvl, lvlIdx) => {
        const baseY = lvl.elevation || lvlIdx * 3.0;
        const levelSources: Array<{ id: string; text: string; x: number; z: number; y: number }> =
          lvl.annotations.map((a) => ({
            id: `${lvl.id}_${a.id}`,
            text: a.text,
            x: a.x,
            z: a.z,
            y: baseY + (a.y ?? 0.35),
          }));

        const existingNames = new Set(levelSources.map((s) => s.text.toLowerCase()));
        for (const r of lvl.rooms) {
          if (!existingNames.has(r.name.toLowerCase()) && r.polygon.length >= 3) {
            const cx =
              r.polygon.reduce((acc, p) => acc + p.x, 0) / r.polygon.length;
            const cz =
              r.polygon.reduce((acc, p) => acc + p.z, 0) / r.polygon.length;
            levelSources.push({
              id: `${lvl.id}_${r.id}`,
              text: r.name,
              x: cx,
              z: cz,
              y: baseY + 0.35,
            });
          }
        }

        for (const s of levelSources) {
          sources.push({ ...s, kind: 'room' });
        }
      });

      for (const ent of entitiesRef.current) {
        const lvlIdx = levels.findIndex((l) => l.id === ent.levelId);
        const lvl = lvlIdx >= 0 ? levels[lvlIdx] : levels[0];
        const baseY = lvl ? lvl.elevation || Math.max(0, lvlIdx) * 3.0 : 0;
        sources.push({
          id: `ent_${ent.id}`,
          text: ent.name,
          x: ent.x,
          z: ent.z,
          y: baseY + ent.elevation + 0.32,
          kind: 'entity',
          status: ent.status,
        });
      }

      for (const s of sources) {
        projectVec.set(s.x, s.y, s.z);
        projectVec.project(camera);
        const visible = projectVec.z < 1 && projectVec.z > -1;
        items.push({
          id: s.id,
          text: s.text,
          x: ((projectVec.x + 1) / 2) * w,
          y: ((-projectVec.y + 1) / 2) * h,
          visible,
          kind: s.kind,
          status: s.status,
        });
      }
      setLabels(items);
    };

    // Smooth camera transition state
    let transitionTargetPos: THREE.Vector3 | null = null;
    let transitionTargetLook: THREE.Vector3 | null = null;
    let lastTime = performance.now();

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const poll = () => {
        if (disposed) return;
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const now = performance.now();
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        let animating = false;
        if (transitionTargetPos && transitionTargetLook) {
          const lambda = 9;
          camera.position.x = THREE.MathUtils.damp(
            camera.position.x,
            transitionTargetPos.x,
            lambda,
            dt
          );
          camera.position.y = THREE.MathUtils.damp(
            camera.position.y,
            transitionTargetPos.y,
            lambda,
            dt
          );
          camera.position.z = THREE.MathUtils.damp(
            camera.position.z,
            transitionTargetPos.z,
            lambda,
            dt
          );
          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            transitionTargetLook.x,
            lambda,
            dt
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            transitionTargetLook.y,
            lambda,
            dt
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            transitionTargetLook.z,
            lambda,
            dt
          );
          if (
            camera.position.distanceTo(transitionTargetPos) < 0.05 &&
            controls.target.distanceTo(transitionTargetLook) < 0.05
          ) {
            transitionTargetPos = null;
            transitionTargetLook = null;
          } else {
            animating = true;
          }
        }

        controls.update();
        renderer.render(scene, camera);
        updateAnnotations();

        const done = () => {
          renderBusy = false;
          if (renderDirty || animating) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    const fitCameraToBounds = (instant = false) => {
      const dist = Math.max(9, sceneRadius * 1.85);
      const pos = new THREE.Vector3(
        sceneCenter.x + dist * 0.62,
        sceneCenter.y + dist * 0.68,
        sceneCenter.z + dist * 0.68
      );
      if (instant) {
        camera.position.copy(pos);
        controls.target.copy(sceneCenter);
        controls.update();
      } else {
        transitionTargetPos = pos;
        transitionTargetLook = sceneCenter.clone();
      }
      requestRender();
    };

    const rebuild = (fitCam = false) => {
      if (currentBuilt) {
        scene.remove(currentBuilt.root);
        currentBuilt.dispose();
      }
      currentBuilt = buildSpaceScene(
        dataRef.current,
        selectedIdRef.current,
        entitiesRef.current,
        selectedEntityIdRef.current
      );
      scene.add(currentBuilt.root);
      equipmentRefs = currentBuilt.equipmentRefs;
      entityRefs = currentBuilt.entityRefs;
      sceneCenter = currentBuilt.center.clone();
      sceneRadius = Math.max(5, currentBuilt.size.length() * 0.55);

      if (fitCam) {
        fitCameraToBounds(true);
      }
      requestRender();
    };

    rebuildSceneRef.current = () => rebuild(false);
    rebuild(true);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    controls.addEventListener('start', () => {
      transitionTargetPos = null;
      transitionTargetLook = null;
    });
    controls.addEventListener('change', requestRender);

    // Raycasting for equipment selection & dragging
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const dragIntersect = new THREE.Vector3();
    let draggingEquipmentId: string | null = null;
    let dragOffset = new THREE.Vector3();
    let pointerDownPos = { x: 0, y: 0 };

    const updatePointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      if (!interactiveRef.current) return;
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      const hitBoxes = equipmentRefs.map((r) => r.hitBox);
      const hits = raycaster.intersectObjects(hitBoxes, false);

      if (hits.length > 0) {
        const eqId = hits[0].object.userData.equipmentId as string;
        if (eqId === selectedIdRef.current) {
          const ref = equipmentRefs.find((r) => r.id === eqId);
          floorPlane.constant = -(ref ? ref.levelElevation + ref.item.elevation / 100 : 0);
          draggingEquipmentId = eqId;
          controls.enabled = false;
          if (raycaster.ray.intersectPlane(floorPlane, dragIntersect) && ref) {
            dragOffset.set(
              ref.group.position.x - dragIntersect.x,
              0,
              ref.group.position.z - dragIntersect.z
            );
          }
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!draggingEquipmentId) return;
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(floorPlane, dragIntersect)) {
        const nx = Number((dragIntersect.x + dragOffset.x).toFixed(2));
        const nz = Number((dragIntersect.z + dragOffset.z).toFixed(2));
        const ref = equipmentRefs.find((r) => r.id === draggingEquipmentId);
        if (ref) {
          ref.group.position.x = nx;
          ref.group.position.z = nz;
          requestRender();
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (draggingEquipmentId) {
        const ref = equipmentRefs.find((r) => r.id === draggingEquipmentId);
        if (ref && onMoveRef.current) {
          onMoveRef.current(
            draggingEquipmentId,
            Number(ref.group.position.x.toFixed(2)),
            Number(ref.group.position.z.toFixed(2))
          );
        }
        draggingEquipmentId = null;
        controls.enabled = true;
        return;
      }

      const moved = Math.hypot(
        e.clientX - pointerDownPos.x,
        e.clientY - pointerDownPos.y
      );
      if (moved > 5) return;

      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);

      if (onSelectEntityRef.current && entityRefs.length > 0) {
        const entHits = raycaster.intersectObjects(
          entityRefs.map((r) => r.hitBox),
          false
        );
        if (entHits.length > 0) {
          const entId = entHits[0].object.userData.entityId as string;
          onSelectEntityRef.current(entId);
          return;
        }
      }

      if (onPickFloorRef.current) {
        floorPlane.constant = 0;
        if (raycaster.ray.intersectPlane(floorPlane, dragIntersect)) {
          onPickFloorRef.current(
            Number(dragIntersect.x.toFixed(2)),
            Number(dragIntersect.z.toFixed(2))
          );
        }
      }

      if (!interactiveRef.current) return;
      const hitBoxes = equipmentRefs.map((r) => r.hitBox);
      const hits = raycaster.intersectObjects(hitBoxes, false);
      if (hits.length > 0) {
        const eqId = hits[0].object.userData.equipmentId as string;
        onSelectRef.current?.(eqId);
      } else {
        onSelectRef.current?.(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    cameraActionsRef.current = {
      zoomIn: () => {
        const dir = new THREE.Vector3()
          .subVectors(controls.target, camera.position)
          .multiplyScalar(0.22);
        transitionTargetPos = camera.position.clone().add(dir);
        transitionTargetLook = controls.target.clone();
        requestRender();
      },
      zoomOut: () => {
        const dir = new THREE.Vector3()
          .subVectors(controls.target, camera.position)
          .multiplyScalar(-0.28);
        transitionTargetPos = camera.position.clone().add(dir);
        transitionTargetLook = controls.target.clone();
        requestRender();
      },
      recenter: () => {
        setIs2D(false);
        fitCameraToBounds(false);
      },
      toggle2D: (to2D: boolean) => {
        const dist = Math.max(10, sceneRadius * 1.9);
        if (to2D) {
          transitionTargetPos = new THREE.Vector3(
            sceneCenter.x,
            sceneCenter.y + dist * 1.15,
            sceneCenter.z + 0.05
          );
        } else {
          transitionTargetPos = new THREE.Vector3(
            sceneCenter.x + dist * 0.62,
            sceneCenter.y + dist * 0.68,
            sceneCenter.z + dist * 0.68
          );
        }
        transitionTargetLook = sceneCenter.clone();
        requestRender();
      },
      capture: () => {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/jpeg', 0.82);
      },
    };

    onSnapshotReady?.(() => cameraActionsRef.current?.capture() ?? null);

    const resizeObserver = new ResizeObserver(() => {
      if (!container || disposed) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      if (nw > 0 && nh > 0) {
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError('3D graphics context paused. Restoring...');
    };
    const onContextRestored = () => {
      setWebglError(null);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();
      if (currentBuilt) currentBuilt.dispose();
      envTex.dispose();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    rebuildSceneRef.current?.();
  }, [data, entities, selectedEquipmentId, selectedEntityId, showAnnotations]);

  useEffect(() => {
    if (externalMode === undefined) return;
    const to2D = externalMode === '2d';
    setIs2D(to2D);
    cameraActionsRef.current?.toggle2D(to2D);
  }, [externalMode]);

  useEffect(() => {
    if (externalShowAnnotations === undefined) return;
    setShowAnnotations(externalShowAnnotations);
  }, [externalShowAnnotations]);

  return (
    <div className="relative w-full h-full overflow-hidden space-3d-bg select-none">
      <div ref={containerRef} className="w-full h-full" />

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#cfd7df] text-slate-700 text-sm">
          {webglError}
        </div>
      )}

      {/* Floating 3D room, zone & entity annotations */}
      {showAnnotations &&
        !compactPreview &&
        labels.map(
          (l) =>
            l.visible && (
              <div
                key={l.id}
                style={{
                  transform: `translate(${l.x}px, ${l.y}px) translate(-50%, -50%)`,
                }}
                className={
                  l.kind === 'entity'
                    ? 'pointer-events-none absolute top-0 left-0 text-[10px] font-semibold text-white bg-[#1f242c]/90 px-2 py-0.5 rounded-full whitespace-nowrap shadow-sm flex items-center gap-1'
                    : 'pointer-events-none absolute top-0 left-0 text-[11px] font-medium text-[#1f242c] px-1.5 py-0.5 whitespace-nowrap drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]'
                }
              >
                {l.kind === 'entity' && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      l.status === 'online'
                        ? 'bg-emerald-400'
                        : l.status === 'warning'
                        ? 'bg-amber-400'
                        : 'bg-slate-400'
                    }`}
                  />
                )}
                <span>{l.text}</span>
              </div>
            )
        )}

      {/* Right floating toolbar matching Screenshot 2 */}
      {showControlsToolbar && !compactPreview && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-10">
          <button
            type="button"
            onClick={() => {
              const next = !is2D;
              setIs2D(next);
              cameraActionsRef.current?.toggle2D(next);
            }}
            className={`w-9 h-9 rounded-md border text-xs font-semibold shadow-sm transition-colors flex items-center justify-center ${
              is2D
                ? 'bg-[#1f242c] text-white border-[#1f242c]'
                : 'bg-white text-[#1f242c] border-[#dde2e8] hover:bg-slate-50'
            }`}
            title="Toggle 2D / 3D camera view"
          >
            {is2D ? '3D' : '2D'}
          </button>

          <div className="bg-white border border-[#dde2e8] rounded-md shadow-sm flex flex-col divide-y divide-[#eef1f5]">
            <button
              type="button"
              onClick={() => {
                setIs2D(false);
                cameraActionsRef.current?.recenter();
              }}
              className="w-9 h-9 flex items-center justify-center text-slate-600 hover:text-[#1f242c] hover:bg-slate-50"
              title="Recenter view"
            >
              <Crosshair className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => cameraActionsRef.current?.zoomIn()}
              className="w-9 h-9 flex items-center justify-center text-slate-600 hover:text-[#1f242c] hover:bg-slate-50"
              title="Zoom in"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => cameraActionsRef.current?.zoomOut()}
              className="w-9 h-9 flex items-center justify-center text-slate-600 hover:text-[#1f242c] hover:bg-slate-50"
              title="Zoom out"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowAnnotations((s) => !s)}
            className={`w-9 h-9 rounded-md border shadow-sm transition-colors flex items-center justify-center ${
              showAnnotations
                ? 'bg-white text-[#1f242c] border-[#dde2e8] hover:bg-slate-50'
                : 'bg-slate-100 text-slate-400 border-[#dde2e8]'
            }`}
            title="Toggle room labels"
          >
            <Tag className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
