import React, { useEffect, useRef, useState } from 'react';
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Trash2,
  Play,
  Code2,
  Globe,
  Download,
  Package,
  Box,
  Layers,
  Tag,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { ApiKeyRecord, SpaceRecord } from '../types/space.ts';

interface DevelopersViewProps {
  spaces: SpaceRecord[];
}

interface SdkViewerHandle {
  setMode: (mode: '2d' | '3d') => void;
  setAnnotations: (visible: boolean) => void;
  destroy: () => void;
}

export const DevelopersView: React.FC<DevelopersViewProps> = ({ spaces }) => {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [sandboxApiKey, setSandboxApiKey] = useState<string>('');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(
    spaces[0]?.id ?? ''
  );
  const [endpointMode, setEndpointMode] = useState<'space' | 'geo' | 'entities'>('space');
  const [apiResponse, setApiResponse] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [snippetTab, setSnippetTab] = useState<'npm' | 'cdn'>('npm');

  // Live SDK Sandbox state
  const sandboxContainerRef = useRef<HTMLDivElement>(null);
  const viewerControllerRef = useRef<SdkViewerHandle | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxActive, setSandboxActive] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [sandboxMode, setSandboxMode] = useState<'3d' | '2d'>('3d');
  const [sandboxAnnotations, setSandboxAnnotations] = useState(true);

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

  useEffect(() => {
    return () => {
      viewerControllerRef.current?.destroy();
      viewerControllerRef.current = null;
    };
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setKeyError(null);
    try {
      const res = await api.createKey(newKeyName.trim());
      setKeys((prev) => [res.key, ...prev]);
      setRevealedKey(res.rawKey);
      setSandboxApiKey(res.rawKey);
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
      const activeKey = sandboxApiKey.trim() || revealedKey || undefined;
      const data =
        endpointMode === 'space'
          ? await api.testSdkSpace(selectedSpaceId, activeKey)
          : endpointMode === 'geo'
          ? await api.testSdkGeo(selectedSpaceId, activeKey)
          : await api.testSdkEntities(selectedSpaceId, activeKey);
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

  const launchSdkSandbox = async () => {
    if (!selectedSpaceId) return;
    const activeKey = sandboxApiKey.trim() || revealedKey || '';
    if (!activeKey) {
      setSandboxError(
        'Create an API key above (or paste your sk_live_... key) to test @spacekit/sdk authentication.'
      );
      return;
    }
    if (!sandboxContainerRef.current) return;

    setSandboxLoading(true);
    setSandboxError(null);
    viewerControllerRef.current?.destroy();
    viewerControllerRef.current = null;

    try {
      const sdkModuleUrl = `${window.location.origin}/sdk/spacekit-sdk.js`;
      const mod = (await import(/* @vite-ignore */ sdkModuleUrl)) as {
        SpaceKit: {
          Space: new (cfg: {
            spaceId: string;
            apiKey: string;
            endpoint: string;
          }) => {
            startViewer: (opts: {
              containerElement: HTMLElement;
              mode: '2d' | '3d';
              showAnnotations: boolean;
            }) => Promise<SdkViewerHandle>;
          };
        };
      };

      const client = new mod.SpaceKit.Space({
        spaceId: selectedSpaceId,
        apiKey: activeKey,
        endpoint: `${window.location.origin}/api/v1`,
      });

      const controller = await client.startViewer({
        containerElement: sandboxContainerRef.current,
        mode: sandboxMode,
        showAnnotations: sandboxAnnotations,
      });

      viewerControllerRef.current = controller;
      setSandboxActive(true);
    } catch (err) {
      setSandboxActive(false);
      setSandboxError(
        err instanceof Error ? err.message : 'Failed to initialize @spacekit/sdk viewer.'
      );
    } finally {
      setSandboxLoading(false);
    }
  };

  const [origin, setOrigin] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : `${window.location.protocol}//${window.location.host}`;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const liveOrigin =
      window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : `${window.location.protocol}//${window.location.host}`;
    setOrigin(liveOrigin);
  }, []);

  const activeDisplayKey = sandboxApiKey.trim() || revealedKey || 'sk_live_your_api_key';

  const npmSnippet = `// 1. Download spacekit-sdk-1.0.0.tgz and run:
//    npm install ./spacekit-sdk-1.0.0.tgz
import { SpaceKit } from '@spacekit/sdk';

const space = new SpaceKit.Space({
  spaceId: '${selectedSpaceId || 'spc_your_space_id'}',
  apiKey: '${activeDisplayKey}',
  endpoint: '${origin}/api/v1'
});

const viewer = await space.startViewer({
  containerId: 'spacekit-viewport',
  mode: '3d',
  showAnnotations: true
});`;

  const cdnSnippet = `<!-- Direct browser ES Module import (no npm install required) -->
<div id="spacekit-viewport" style="width:100%;height:520px;"></div>
<script type="module">
  import { SpaceKit } from '${origin}/sdk/spacekit-sdk.js';

  const space = new SpaceKit.Space({
    spaceId: '${selectedSpaceId || 'spc_your_space_id'}',
    apiKey: '${activeDisplayKey}',
    endpoint: '${origin}/api/v1'
  });

  const viewer = await space.startViewer({
    containerId: 'spacekit-viewport',
    mode: '3d',
    showAnnotations: true
  });
</script>`;

  const currentSnippet = snippetTab === 'npm' ? npmSnippet : cdnSnippet;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#e5e8ec] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f242c]">
            Developers &amp; Spatial SDK
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Download the installable <code className="font-mono text-xs">@spacekit/sdk</code> package, stream GeoJSON building footprints, and embed 3D viewers via REST or JS SDK.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`${origin}/sdk/spacekit-sdk-1.0.0.tgz`}
            download="spacekit-sdk-1.0.0.tgz"
            className="px-3.5 py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md text-xs font-medium inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download @spacekit/sdk (.tgz)</span>
          </a>
          <a
            href={`${origin}/sdk/spacekit-sdk.d.ts`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 bg-white border border-[#d6dce3] hover:bg-slate-50 text-[#1f242c] rounded-md text-xs font-medium inline-flex items-center gap-1.5"
          >
            <Code2 className="w-3.5 h-3.5 text-slate-500" />
            <span>TypeScript .d.ts</span>
          </a>
        </div>
      </div>

      {/* SDK Distribution & Package Install Banner */}
      <section className="bg-white border border-[#e5e8ec] rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-[#1f242c]" />
            <h2 className="text-sm font-semibold text-[#1f242c]">
              SDK Package Distribution (<code className="font-mono text-xs">@spacekit/sdk@1.0.0</code>)
            </h2>
          </div>
          {origin && (
            <span className="text-[11px] font-mono text-slate-500">
              Active Host: <span className="text-[#1f242c]">{origin}</span>
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-[#f4f6f9] border border-[#e5e8ec] rounded-md p-3.5 space-y-2">
            <div className="font-semibold text-[#1f242c]">
              1. Install offline/local tarball via npm
            </div>
            <p className="text-slate-600">
              Download <code className="font-mono">spacekit-sdk-1.0.0.tgz</code> and install directly in any React, Vite, Next.js, or Node.js project:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-[#1a1f26] text-slate-100 rounded px-2.5 py-1.5 font-mono text-[11px] break-all select-all">
                npm install {origin}/sdk/spacekit-sdk-1.0.0.tgz
              </code>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    `npm install ${origin}/sdk/spacekit-sdk-1.0.0.tgz`,
                    'npminstall'
                  )
                }
                className="px-2.5 py-1.5 bg-white border border-[#d6dce3] rounded text-[#1f242c] font-medium inline-flex items-center gap-1 shrink-0"
              >
                {copiedId === 'npminstall' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedId === 'npminstall' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div className="bg-[#f4f6f9] border border-[#e5e8ec] rounded-md p-3.5 space-y-2">
            <div className="font-semibold text-[#1f242c]">
              2. Direct Browser ES Module URL (CDN)
            </div>
            <p className="text-slate-600">
              Import directly in any browser without a build step. CORS headers are enabled on all <code className="font-mono">/api/v1/*</code> and <code className="font-mono">/sdk/*</code> routes:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-[#1a1f26] text-slate-100 rounded px-2.5 py-1.5 font-mono text-[11px] break-all select-all">
                {origin}/sdk/spacekit-sdk.js
              </code>
              <button
                type="button"
                onClick={() => handleCopy(`${origin}/sdk/spacekit-sdk.js`, 'esmurl')}
                className="px-2.5 py-1.5 bg-white border border-[#d6dce3] rounded text-[#1f242c] font-medium inline-flex items-center gap-1 shrink-0"
              >
                {copiedId === 'esmurl' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedId === 'esmurl' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-[#1f242c]" />
              <h2 className="text-sm font-semibold text-[#1f242c]">
                SpaceKit JS SDK Integration
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded border border-[#d6dce3] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSnippetTab('npm')}
                  className={`px-2 py-0.5 rounded font-medium ${
                    snippetTab === 'npm'
                      ? 'bg-[#1f242c] text-white'
                      : 'text-slate-600 hover:text-[#1f242c]'
                  }`}
                >
                  npm (@spacekit/sdk)
                </button>
                <button
                  type="button"
                  onClick={() => setSnippetTab('cdn')}
                  className={`px-2 py-0.5 rounded font-medium ${
                    snippetTab === 'cdn'
                      ? 'bg-[#1f242c] text-white'
                      : 'text-slate-600 hover:text-[#1f242c]'
                  }`}
                >
                  Browser ESM
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(currentSnippet, 'sdk')}
                className="px-2.5 py-1 border border-[#d6dce3] rounded text-xs font-medium text-[#1f242c] hover:bg-slate-50 flex items-center gap-1"
              >
                {copiedId === 'sdk' ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedId === 'sdk' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <pre className="bg-[#1a1f26] text-slate-100 rounded-md p-4 text-xs font-mono overflow-x-auto leading-relaxed">
            {currentSnippet}
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

      {/* Live SDK startViewer() Interactive Sandbox */}
      <section className="bg-white border border-[#e5e8ec] rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-[#1f242c]" />
              <h2 className="text-sm font-semibold text-[#1f242c]">
                Live SDK <code className="font-mono text-xs">startViewer()</code> Sandbox
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Imports the real <code className="font-mono">/sdk/spacekit-sdk.js</code> runtime, authenticates with your <code className="font-mono">sk_live_...</code> key, and mounts the interactive 3D/2D viewer below.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="password"
              value={sandboxApiKey}
              onChange={(e) => setSandboxApiKey(e.target.value)}
              placeholder="Paste sk_live_... API key"
              className="border border-[#d6dce3] rounded-md px-2.5 py-1.5 w-52 font-mono text-xs focus:outline-none focus:border-[#1f242c]"
            />
            <button
              type="button"
              disabled={!selectedSpaceId || sandboxLoading}
              onClick={launchSdkSandbox}
              className="px-3.5 py-1.5 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md font-medium inline-flex items-center gap-1.5 disabled:opacity-45"
            >
              <Play className="w-3.5 h-3.5" />
              <span>
                {sandboxLoading
                  ? 'Starting SDK...'
                  : sandboxActive
                  ? 'Reload SDK Viewer'
                  : 'Run startViewer()'}
              </span>
            </button>
          </div>
        </div>

        {sandboxActive && (
          <div className="flex items-center gap-2 text-xs bg-[#f4f6f9] border border-[#e5e8ec] rounded-md px-3 py-2">
            <span className="text-slate-600 font-medium mr-1">SDK Controls:</span>
            <button
              type="button"
              onClick={() => {
                const next = sandboxMode === '3d' ? '2d' : '3d';
                setSandboxMode(next);
                viewerControllerRef.current?.setMode(next);
              }}
              className="px-2.5 py-1 bg-white border border-[#d6dce3] rounded font-medium inline-flex items-center gap-1 hover:bg-slate-50"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>setMode(&lsquo;{sandboxMode === '3d' ? '2d' : '3d'}&rsquo;)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !sandboxAnnotations;
                setSandboxAnnotations(next);
                viewerControllerRef.current?.setAnnotations(next);
              }}
              className="px-2.5 py-1 bg-white border border-[#d6dce3] rounded font-medium inline-flex items-center gap-1 hover:bg-slate-50"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>setAnnotations({String(!sandboxAnnotations)})</span>
            </button>
          </div>
        )}

        {sandboxError && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {sandboxError}
          </div>
        )}

        <div
          ref={sandboxContainerRef}
          className="w-full h-[380px] rounded-md border border-[#d6dce3] bg-[#cfd7df] overflow-hidden flex items-center justify-center text-xs text-slate-600"
        >
          <span>
            Create or paste an API key above and click &ldquo;Run startViewer()&rdquo; to mount a live @spacekit/sdk 3D instance.
          </span>
        </div>
      </section>
    </div>
  );
};
