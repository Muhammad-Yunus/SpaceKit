import React, { useEffect, useState } from 'react';
import { FolderKanban, Plus, Trash2, Layers, Eye, MapPin, Activity } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { ProjectRecord, SpaceRecord } from '../types/space.ts';

export const ProjectsView: React.FC<{
  spaces: SpaceRecord[];
  onOpenSpace: (space: SpaceRecord) => void;
}> = ({ spaces, onOpenSpace }) => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'staging'>('production');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listProjects()
      .then((res) => setProjects(res.projects))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await api.createProject({
      name: name.trim(),
      description: description.trim(),
      environment,
    });
    setProjects((prev) => [res.project, ...prev]);
    setName('');
    setDescription('');
  };

  const handleDelete = async (id: string) => {
    await api.deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#e5e8ec] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f242c]">Projects</h1>
          <p className="text-sm text-slate-500 mt-1">
            Group digitized 3D spaces into deployment environments and spatial applications.
          </p>
        </div>

        <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="border border-[#d6dce3] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-[#1f242c]"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="border border-[#d6dce3] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-[#1f242c]"
          />
          <select
            value={environment}
            onChange={(e) =>
              setEnvironment(e.target.value as 'production' | 'staging')
            }
            className="border border-[#d6dce3] rounded-md px-3 py-2 text-xs"
          >
            <option value="production">Production</option>
            <option value="staging">Staging</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md text-xs font-medium flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New project</span>
          </button>
        </form>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-[#e5e8ec] rounded-lg p-12 text-center space-y-2">
          <FolderKanban className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-medium text-[#1f242c]">No projects yet</p>
          <p className="text-xs text-slate-500">
            Create a project above to organize your 3D buildings and geospatial SDK feeds.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((p) => {
            const linked = spaces.filter((s) => s.projectId === p.id);
            return (
              <div
                key={p.id}
                className="bg-white border border-[#e5e8ec] rounded-lg p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-[#1f242c]">
                      {p.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      className="text-slate-400 hover:text-red-600 p-1"
                      title="Delete project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    {p.description || 'No project description'}
                  </p>
                  <div className="text-xs text-slate-500 flex items-center gap-2 pt-1">
                    <span className="capitalize">{p.environment}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {linked.length} {linked.length === 1 ? 'space' : 'spaces'}
                    </span>
                  </div>
                </div>

                {linked.length > 0 && (
                  <div className="pt-3 border-t border-[#eef1f5] space-y-1">
                    {linked.slice(0, 3).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onOpenSpace(s)}
                        className="w-full text-left text-xs text-[#1f242c] hover:underline truncate"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const UsageView: React.FC = () => {
  const [usage, setUsage] = useState<{
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
  } | null>(null);

  useEffect(() => {
    api
      .getUsage()
      .then((res) => setUsage(res.usage))
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="border-b border-[#e5e8ec] pb-5">
        <h1 className="text-2xl font-semibold text-[#1f242c]">Usage</h1>
        <p className="text-sm text-slate-500 mt-1">
          Live spatial storage, digitized floor area, viewer impressions, and SDK API consumption from PostgreSQL.
        </p>
      </div>

      {!usage ? (
        <div className="py-12 text-center text-xs text-slate-400">
          Loading usage metrics...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Total Spaces', value: usage.totalSpaces, icon: Layers },
              {
                label: 'Digitized Sqft',
                value: usage.totalSqft.toLocaleString(),
                icon: Activity,
              },
              {
                label: '3D Viewer Views',
                value: usage.totalViews.toLocaleString(),
                icon: Eye,
              },
              {
                label: 'Geolocated Spaces',
                value: usage.geolocatedSpaces,
                icon: MapPin,
              },
              {
                label: 'SDK API Requests',
                value: usage.totalApiRequests.toLocaleString(),
                icon: Activity,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-white border border-[#e5e8ec] rounded-lg p-4 space-y-1.5"
              >
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
                  {stat.label}
                </div>
                <div className="text-2xl font-semibold text-[#1f242c] tabular-nums">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-[#e5e8ec] rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#e5e8ec] text-sm font-semibold text-[#1f242c]">
              Space Breakdown
            </div>
            {usage.spacesBreakdown.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No digitized spaces yet. Upload a 2D CAD floor plan to view usage metrics.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-[#e5e8ec] text-slate-500 bg-[#f8fafc]">
                      <th className="py-2.5 px-4 font-medium">Space</th>
                      <th className="py-2.5 px-4 font-medium text-right">Area (sqft)</th>
                      <th className="py-2.5 px-4 font-medium text-right">Levels</th>
                      <th className="py-2.5 px-4 font-medium text-right">Equipment</th>
                      <th className="py-2.5 px-4 font-medium text-right">Complexity</th>
                      <th className="py-2.5 px-4 font-medium text-right">Payload</th>
                      <th className="py-2.5 px-4 font-medium text-right">Views</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef1f5] tabular-nums">
                    {usage.spacesBreakdown.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-medium text-[#1f242c]">
                          {s.name}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {s.sqft.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right">{s.levels}</td>
                        <td className="py-2.5 px-4 text-right">{s.equipmentCount}</td>
                        <td className="py-2.5 px-4 text-right">{s.complexity}</td>
                        <td className="py-2.5 px-4 text-right">{s.sizeKb} kb</td>
                        <td className="py-2.5 px-4 text-right">
                          {s.views.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
