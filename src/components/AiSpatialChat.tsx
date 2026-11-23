import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Send,
  ImagePlus,
  Loader2,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { AgentStepTrace, AiChatMessage, SpaceRecord } from '../types/space.ts';

interface AiSpatialChatProps {
  open: boolean;
  space: SpaceRecord;
  onClose: () => void;
  onSpaceUpdated: (space: SpaceRecord) => void;
}

export const AiSpatialChat: React.FC<AiSpatialChatProps> = ({
  open,
  space,
  onClose,
  onSpaceUpdated,
}) => {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [traceByMessageId, setTraceByMessageId] = useState<Record<string, AgentStepTrace[]>>({});
  const [input, setInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !space.id) return;
    setLoadingHistory(true);
    api
      .getChat(space.id)
      .then((res) => setMessages(res.messages))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [open, space.id]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  if (!open) return null;

  const handlePickImage = (file: File | null) => {
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !imageFile) || loading) return;

    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('spaceId', space.id);
      fd.append('message', input.trim());
      if (imageFile) fd.append('image', imageFile);

      const res = await api.sendChat(fd);
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
      if (res.agentTrace && res.agentTrace.length > 0) {
        setTraceByMessageId((prev) => ({
          ...prev,
          [res.assistantMessage.id]: res.agentTrace!,
        }));
      }
      setInput('');
      setImageFile(null);
      setImagePreview(null);

      if (res.appliedDesignUpdate) {
        onSpaceUpdated(res.space);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'AI Spatial Chat request failed.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed right-4 bottom-4 top-16 z-40 w-[380px] max-w-[92vw] bg-white border border-[#dce1e7] rounded-lg shadow-2xl flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[#e5e8ec] flex items-center justify-between bg-[#1a1f26] text-white">
        <div>
          <h3 className="text-xs font-semibold">SpaceKit AI Architect</h3>
          <p className="text-[11px] text-slate-300 truncate max-w-[260px]">
            Generate, upload 2D CAD, or modify {space.name}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#f8fafc] text-xs">
        {loadingHistory ? (
          <div className="py-8 text-center text-slate-400">
            Loading conversation...
          </div>
        ) : messages.length === 0 ? (
          <div className="space-y-3 py-4">
            <div className="bg-white border border-[#e5e8ec] rounded-md p-3 text-slate-600 leading-relaxed">
              <p className="font-medium text-[#1f242c] mb-1">
                Ready to design in 2D &amp; 3D
              </p>
              <p>
                Ask me to generate a floor plan from scratch, upload a 2D technical drawing image, or modify walls and furniture in real time.
              </p>
            </div>
            <div className="space-y-1.5">
              {[
                'Generate a 1,400 sqft modern office with 3 glass rooms and a lounge',
                'Add a conference table with 6 office chairs in the largest room',
                'Add wall-mounted AC units and indoor plants along the windows',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setInput(suggestion)}
                  className="w-full text-left px-3 py-2 bg-white border border-[#e5e8ec] hover:border-[#1f242c] rounded-md text-[11px] text-[#3b434f] transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${
                m.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[88%] rounded-lg px-3 py-2 leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#1f242c] text-white'
                    : 'bg-white border border-[#e5e8ec] text-[#1f242c]'
                }`}
              >
                {m.imageDataUrl && (
                  <img
                    src={m.imageDataUrl}
                    alt="Uploaded floor plan reference"
                    className="max-h-36 rounded mb-2 border border-white/20 object-contain bg-white"
                  />
                )}
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.appliedDesignUpdate && (
                  <div className="mt-2 pt-1.5 border-t border-slate-100 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>3D Three.js &amp; 2D layout updated</span>
                    </div>
                    {traceByMessageId[m.id] && (
                      <div className="space-y-0.5 pl-5 text-[10px] text-slate-500">
                        {traceByMessageId[m.id].map((t) => (
                          <div key={`${t.step}-${t.phase}`}>
                            {t.step}. {t.phase} — {t.detail}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 px-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Designing spatial geometry...</span>
          </div>
        )}
        {error && (
          <div className="p-2.5 rounded bg-red-50 border border-red-200 text-red-700 text-[11px]">
            {error}
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="p-3 border-t border-[#e5e8ec] bg-white space-y-2"
      >
        {imagePreview && (
          <div className="relative inline-block">
            <img
              src={imagePreview}
              alt="Attachment preview"
              className="h-16 rounded border border-[#d6dce3] object-cover"
            />
            <button
              type="button"
              onClick={() => {
                setImageFile(null);
                setImagePreview(null);
              }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 shrink-0 border border-[#d6dce3] rounded-md flex items-center justify-center text-slate-600 hover:bg-slate-50"
            title="Attach 2D CAD or floor plan image"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe design changes or upload a 2D plan..."
            className="flex-1 border border-[#d6dce3] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-[#1f242c]"
          />
          <button
            type="submit"
            disabled={loading || (!input.trim() && !imageFile)}
            className="w-9 h-9 shrink-0 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md flex items-center justify-center disabled:opacity-45"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
};
