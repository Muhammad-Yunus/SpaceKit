import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  CloudUpload,
  FileImage,
  PenTool,
  Loader2,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { AgentStepTrace, SpaceRecord } from '../types/space.ts';

interface CadUploadModalProps {
  open: boolean;
  targetSpaceId?: string;
  onClose: () => void;
  onSpaceReady: (space: SpaceRecord) => void;
}

const AGENTIC_STAGES = [
  'Analyzing 2D CAD floor plan & wall topology',
  'Auditing corner closure & wall-opening projections',
  'Synthesizing verified 3D Three.js scene geometry',
];

export const CadUploadModal: React.FC<CadUploadModalProps> = ({
  open,
  targetSpaceId,
  onClose,
  onSpaceReady,
}) => {
  const [tab, setTab] = useState<'cad' | 'blank'>('cad');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [promptHint, setPromptHint] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const [agentTrace, setAgentTrace] = useState<AgentStepTrace[] | null>(null);
  const [completedSpace, setCompletedSpace] = useState<SpaceRecord | null>(null);
  const [aiStatus, setAiStatus] = useState<{
    configured: boolean;
    provider: string;
    model: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setName('');
      setDescription('');
      setPromptHint('');
      setFile(null);
      setPreviewUrl(null);
      setTab('cad');
      setAgentTrace(null);
      setCompletedSpace(null);
      setError(null);
      return;
    }
    setAgentTrace(null);
    setCompletedSpace(null);
    setError(null);
    api
      .getAiConfig()
      .then((res) => setAiStatus(res))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!loading) {
      setActiveStage(0);
      return;
    }
    const timer = window.setInterval(() => {
      setActiveStage((s) => (s < AGENTIC_STAGES.length - 1 ? s + 1 : s));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [loading]);

  if (!open) return null;

  const handleFileChange = (selected: File | null) => {
    setError(null);
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setError('Please upload a PNG, JPG, or WebP 2D floor plan image.');
      return;
    }
    setFile(selected);
    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);
  };

  const handleCadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Select a 2D CAD or floor plan image first.');
      return;
    }
    setLoading(true);
    setError(null);
    setAgentTrace(null);
    try {
      const fd = new FormData();
      fd.append('cadImage', file);
      if (name.trim()) fd.append('name', name.trim());
      if (promptHint.trim()) fd.append('promptHint', promptHint.trim());
      if (targetSpaceId) fd.append('spaceId', targetSpaceId);

      const res = await api.cadTo3D(fd);
      if (res.agentTrace && res.agentTrace.length > 0) {
        setAgentTrace(res.agentTrace);
        setCompletedSpace(res.space);
      } else {
        onSpaceReady(res.space);
        onClose();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to convert 2D CAD image.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBlank = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.createSpace({
        name: name.trim() || 'Untitled space',
        description: description.trim(),
      });
      onSpaceReady(res.space);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create blank space.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white border border-[#e5e8ec] rounded-lg shadow-xl w-full max-w-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e8ec]">
          <div>
            <h2 className="text-base font-semibold text-[#1f242c]">
              {targetSpaceId
                ? 'Import 2D CAD Technical Drawing'
                : 'Create new space'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Agentic 2D CAD-to-3D Three.js synthesis via OpenAI-compatible Vision &amp; Geometry Solver.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!targetSpaceId && !completedSpace && (
          <div className="flex border-b border-[#e5e8ec] px-5 gap-6 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setTab('cad');
                setError(null);
              }}
              className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === 'cad'
                  ? 'border-[#1f242c] text-[#1f242c]'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>Upload 2D CAD Image (Agentic 3D)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('blank');
                setError(null);
              }}
              className={`py-3 border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === 'blank'
                  ? 'border-[#1f242c] text-[#1f242c]'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Blank 2D CAD Canvas</span>
            </button>
          </div>
        )}

        {aiStatus && !aiStatus.configured && tab === 'cad' && (
          <div className="mx-5 mt-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>
              Configure <code className="font-mono">AI_BASE_URL</code>,{' '}
              <code className="font-mono">AI_KEY</code>, and{' '}
              <code className="font-mono">AI_MODEL</code> in{' '}
              <strong>Settings &gt; Secrets</strong> to run Agentic 2D-to-3D Three.js translation.
            </span>
          </div>
        )}

        {error && (
          <div className="mx-5 mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {completedSpace && agentTrace ? (
          <div className="p-5 space-y-4 text-xs">
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3.5 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-950">
                  3D Three.js space synthesized: {completedSpace.name}
                </p>
                <p className="text-emerald-800 mt-0.5">
                  {completedSpace.sqft.toLocaleString()} sqft · Complexity {completedSpace.complexity}/10
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-[#1f242c] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span>Agentic 2D → 3D Execution Steps</span>
              </p>
              <div className="border border-[#e5e8ec] rounded-md divide-y divide-[#eef1f5]">
                {agentTrace.map((t) => (
                  <div key={`${t.step}-${t.phase}`} className="p-2.5 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#1f242c] text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                      {t.step}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-[#1f242c]">{t.phase}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{t.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#eef1f5]">
              <button
                type="button"
                onClick={() => {
                  onSpaceReady(completedSpace);
                  onClose();
                }}
                className="px-4 py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md font-medium flex items-center gap-2"
              >
                <span>Open in 3D Three.js Studio</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : tab === 'cad' ? (
          <form onSubmit={handleCadSubmit} className="p-5 space-y-4 text-xs">
            {!targetSpaceId && (
              <div>
                <label className="block font-medium text-[#1f242c] mb-1">
                  Space name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-detected from CAD drawing if left blank"
                  className="w-full border border-[#d6dce3] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-[#1f242c]"
                />
              </div>
            )}

            <div>
              <label className="block font-medium text-[#1f242c] mb-1.5">
                2D CAD / Technical Floor Plan Image
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFileChange(e.dataTransfer.files?.[0] ?? null);
                }}
                className="border-2 border-dashed border-[#cbd5e1] hover:border-[#1f242c] rounded-lg p-5 text-center cursor-pointer bg-[#f8fafc] transition-colors"
              >
                {previewUrl ? (
                  <div className="space-y-2">
                    <img
                      src={previewUrl}
                      alt="Uploaded 2D CAD drawing"
                      className="max-h-48 mx-auto rounded border border-[#e5e8ec] object-contain bg-white"
                    />
                    <p className="text-[11px] text-slate-600 flex items-center justify-center gap-1.5">
                      <FileImage className="w-3.5 h-3.5" />
                      <span>{file?.name}</span>
                    </p>
                  </div>
                ) : (
                  <div className="py-4 space-y-2">
                    <CloudUpload className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="font-medium text-[#1f242c]">
                      Click or drag &amp; drop a 2D CAD floor plan image
                    </p>
                    <p className="text-[11px] text-slate-500">
                      PNG, JPG, or WebP architectural blueprint — AI Vision Agent extracts walls, doors, windows, rooms, and furniture into 3D Three.js
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block font-medium text-[#1f242c] mb-1">
                Architectural scale / instructions (optional)
              </label>
              <input
                type="text"
                value={promptHint}
                onChange={(e) => setPromptHint(e.target.value)}
                placeholder="e.g. Ceiling height 3.0m, 15m x 10m footprint, furnish Office 1 & Lounge"
                className="w-full border border-[#d6dce3] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-[#1f242c]"
              />
            </div>

            {loading && (
              <div className="bg-[#f4f6f9] border border-[#e5e8ec] rounded-md p-3 space-y-1.5">
                {AGENTIC_STAGES.map((label, idx) => (
                  <div
                    key={label}
                    className={`flex items-center gap-2 text-[11px] ${
                      idx <= activeStage ? 'text-[#1f242c] font-medium' : 'text-slate-400'
                    }`}
                  >
                    {idx < activeStage ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : idx === activeStage ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1f242c] shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-slate-300 shrink-0" />
                    )}
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#eef1f5]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-[#d6dce3] rounded-md font-medium text-[#1f242c] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !file}
                className="px-4 py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Running Agentic 3D Build...</span>
                  </>
                ) : (
                  <>
                    <span>Generate 3D Space</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreateBlank} className="p-5 space-y-4 text-xs">
            <div>
              <label className="block font-medium text-[#1f242c] mb-1">
                Space name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jakarta HQ Floor 3"
                className="w-full border border-[#d6dce3] rounded-md px-3 py-2 focus:outline-none focus:border-[#1f242c]"
              />
            </div>
            <div>
              <label className="block font-medium text-[#1f242c] mb-1">
                Description
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short architectural summary for your team or SDK consumers..."
                className="w-full border border-[#d6dce3] rounded-md px-3 py-2 focus:outline-none focus:border-[#1f242c]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#eef1f5]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-[#d6dce3] rounded-md font-medium text-[#1f242c] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md font-medium disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Open 2D CAD Editor'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
