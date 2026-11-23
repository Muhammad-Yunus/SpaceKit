import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Trash2,
  Play,
  Code2,
  Globe,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { ApiKeyRecord, SpaceRecord } from '../types/space.ts';

interface DevelopersViewProps {
  spaces: SpaceRecord[];
}

export const DevelopersView: React.FC<DevelopersViewProps> = ({ spaces }) => {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(
    spaces[0]?.id ?? ''
  );
  const [endpointMode, setEndpointMode] = useState<'space' | 'geo' | 'entities'>('space');
  const [apiResponse, setApiResponse] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  useEffect(() => {
    api
      .listKeys()
      .then((res) => setKeys(res.keys))
      .catch((err) =>
        setKeyError(err instanceof Error ? err.message : 'Failed to load API keys')
      );
  }, []);

  useEffect(() => {
    if (!selectedSpaceId && spaces[0]?.id) {
      setSelectedSpaceId(spaces[0].id);
    }
  }, [spaces, selectedSpaceId]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setKeyError(null);
    try {
      const res = await api.createKey(newKeyName.trim());
      setKeys((prev) => [res.key, ...prev]);
      setRevealedKey(res.rawKey);
      setNewKeyName('');
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to create key');
    }
  };

  const handleRevoke = async (id: string) => {
    setKeyError(null);
    try {
      await api.deleteKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setConfirmRevokeId(null);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to revoke key');
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const runLiveTest = async () => {
    if (!selectedSpaceId) return;
    setTesting(true);
    try {
      const data =
        endpointMode === 'space'
          ? await api.testSdkSpace(selectedSpaceId, revealedKey || undefined)
          : endpointMode === 'geo'
          ? await api.testSdkGeo(selectedSpaceId, revealedKey || undefined)
          : await api.testSdkEntities(selectedSpaceId, revealedKey || undefined);
      setApiResponse(JSON.stringify(data, null, 2));
    } catch (err) {
      setApiResponse(
        JSON.stringify(
          { error: err instanceof Error ? err.message : 'Request failed' },
          null,
          2
        )
      );
    } finally {
      setTesting(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const sdkSnippet = `import { SpaceKit } from '@spacekit/sdk';

const space = new SpaceKit.Space({
  spaceId: '${selectedSpaceId || 'spc_your_space_id'}',
  apiKey: '${revealedKey || 'sk_live_your_api_key'}',
  endpoint: '${origin}/api/v1'
});

await space.startViewer({
  containerId: 'spacekit-viewport',
  mode: '3d',
  showAnnotations: true
});`;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#e5e8ec] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f242c]">
            Developers &amp; Spatial SDK
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Embed 3D SpaceKit floor plans, stream GeoJSON building footprints, and query spatial geometry via REST or JS SDK.
          </p>
        </div>
      </div>

      {/* API Keys Management */}
      <section className="bg-white border border-[#e5e8ec] rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#1f242c]" />
            <h2 className="text-sm font-semibold text-[#1f242c]">
              SpaceKit API Keys
            </h2>
          </div>

          <form onSubmit={handleCreateKey} className="flex items-center gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key label (e.g. Web Map App)"
              className="border border-[#d6dce3] rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-[#1f242c]"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create API Key</span>
            </button>
          </form>
        </div>

        {revealedKey && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md flex items-center justify-between gap-3 text-xs">
            <div>
              <span className="font-semibold text-emerald-900">
                New API key created (copy now — shown once):{' '}
              </span>
              <code className="font-mono text-emerald-800">{revealedKey}</code>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(revealedKey, 'newkey')}
              className="px-2.5 py-1 bg-white border border-emerald-300 rounded text-emerald-900 font-medium flex items-center gap-1 shrink-0"
            >
              {copiedId === 'newkey' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedId === 'newkey' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        )}

        {keyError && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {keyError}
          </div>
        )}

        {keys.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">
            No API keys yet. Create a key above to authenticate external SDK and REST requests.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[#e5e8ec] text-slate-500">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Key Prefix</th>
                  <th className="py-2 font-medium text-right">Requests</th>
                  <th className="py-2 font-medium text-right">Created</th>
                  <th className="py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f5]">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-50">
                    <td className="py-2.5 font-medium text-[#1f242c]">{k.name}</td>
                    <td className="py-2.5 font-mono text-slate-600">{k.keyPrefix}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">
                      {k.requestCount.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-slate-500">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 text-right">
                      {confirmRevokeId === k.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleRevoke(k.id)}
                            className="px-2 py-0.5 bg-red-600 text-white rounded text-[11px] font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRevokeId(null)}
                            className="px-2 py-0.5 border border-[#d6dce3] rounded text-[11px] text-slate-600"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(k.id)}
                          className="text-red-600 hover:text-red-800 inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Revoke</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SDK Code & Live REST API Tester */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-[#e5e8ec] rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-[#1f242c]" />
              <h2 className="text-sm font-semibold text-[#1f242c]">
                SpaceKit JS SDK Integration
              </h2>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(sdkSnippet, 'sdk')}
              className="px-2.5 py-1 border border-[#d6dce3] rounded text-xs font-medium text-[#1f242c] hover:bg-slate-50 flex items-center gap-1"
            >
              {copiedId === 'sdk' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedId === 'sdk' ? 'Copied' : 'Copy snippet'}</span>
            </button>
          </div>

          <pre className="bg-[#1a1f26] text-slate-100 rounded-md p-4 text-xs font-mono overflow-x-auto leading-relaxed">
            {sdkSnippet}
          </pre>
        </section>

        <section className="bg-white border border-[#e5e8ec] rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#1f242c]" />
              <h2 className="text-sm font-semibold text-[#1f242c]">
                Live Spatial REST &amp; GeoJSON API
              </h2>
            </div>

            <button
              type="button"
              disabled={!selectedSpaceId || testing}
              onClick={runLiveTest}
              className="px-3 py-1.5 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md text-xs font-medium flex items-center gap-1.5 disabled:opacity-45"
            >
              <Play className="w-3 h-3" />
              <span>{testing ? 'Fetching...' : 'Send Request'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <select
              value={selectedSpaceId}
              onChange={(e) => setSelectedSpaceId(e.target.value)}
              className="flex-1 border border-[#d6dce3] rounded-md px-2.5 py-1.5"
            >
              {spaces.length === 0 ? (
                <option value="">Create or upload a space first</option>
              ) : (
                spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))
              )}
            </select>

            <select
              value={endpointMode}
              onChange={(e) =>
                setEndpointMode(e.target.value as 'space' | 'geo' | 'entities')
              }
              className="border border-[#d6dce3] rounded-md px-2.5 py-1.5 font-mono"
            >
              <option value="space">GET /api/v1/spaces/:id</option>
              <option value="geo">GET /api/v1/spaces/:id/geo</option>
              <option value="entities">GET /api/v1/spaces/:id/entities</option>
            </select>
          </div>

          <pre className="bg-[#f4f6f9] border border-[#e5e8ec] rounded-md p-3 text-[11px] font-mono text-[#1f242c] h-52 overflow-auto">
            {apiResponse ||
              '// Click "Send Request" to inspect live PostgreSQL spatial JSON or GeoJSON output.'}
          </pre>
        </section>
      </div>
    </div>
  );
};
