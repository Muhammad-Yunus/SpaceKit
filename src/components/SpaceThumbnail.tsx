import React, { useMemo } from 'react';
import type { SpaceRecord } from '../types/space.ts';

export const SpaceThumbnail: React.FC<{ space: SpaceRecord }> = ({ space }) => {
  const walls = space.data?.levels?.[0]?.walls ?? [];

  const isometricWalls = useMemo(() => {
    if (walls.length === 0) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const w of walls) {
      minX = Math.min(minX, w.x1, w.x2);
      maxX = Math.max(maxX, w.x1, w.x2);
      minZ = Math.min(minZ, w.z1, w.z2);
      maxZ = Math.max(maxZ, w.z1, w.z2);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const span = Math.max(6, maxX - minX, maxZ - minZ);
    const scale = 120 / span;

    // Simple isometric projection onto 280x160 SVG canvas
    const project = (x: number, y: number, z: number) => {
      const rx = (x - cx) * scale;
      const rz = (z - cz) * scale;
      const ry = y * scale;
      const sx = 140 + (rx - rz * 0.35);
      const sy = 95 + (rz * 0.55 - ry * 0.85);
      return { x: sx, y: sy };
    };

    const floorCorners = [
      project(minX, 0, minZ),
      project(maxX, 0, minZ),
      project(maxX, 0, maxZ),
      project(minX, 0, maxZ),
    ];

    const wallQuads = walls.map((w) => {
      const h = w.height || 2.8;
      const p1 = project(w.x1, 0, w.z1);
      const p2 = project(w.x2, 0, w.z2);
      const p3 = project(w.x2, h, w.z2);
      const p4 = project(w.x1, h, w.z1);
      return {
        id: w.id,
        points: `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`,
      };
    });

    return {
      floorPoints: floorCorners.map((p) => `${p.x},${p.y}`).join(' '),
      wallQuads,
    };
  }, [walls]);

  if (space.thumbnailUrl) {
    return (
      <img
        src={space.thumbnailUrl}
        alt={space.name}
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover"
      />
    );
  }

  return (
    <div className="w-full h-full bg-[#cfd7df] flex items-center justify-center">
      {isometricWalls ? (
        <svg viewBox="0 0 280 160" className="w-full h-full">
          <polygon
            points={isometricWalls.floorPoints}
            fill="#e2e7ec"
            stroke="#cbd5e1"
            strokeWidth="1"
          />
          {isometricWalls.wallQuads.map((q) => (
            <polygon
              key={q.id}
              points={q.points}
              fill="rgba(248, 250, 252, 0.88)"
              stroke="#cbd5e1"
              strokeWidth="0.8"
            />
          ))}
        </svg>
      ) : (
        <div className="text-[11px] font-medium text-slate-500">
          Empty CAD Canvas
        </div>
      )}
    </div>
  );
};
