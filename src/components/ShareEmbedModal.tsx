import React, { useState } from 'react';
import { X, Copy, Check, Code2, Globe, Link as LinkIcon, Download } from 'lucide-react';
import type { SpaceRecord } from '../types/space.ts';

interface ShareEmbedModalProps {
  open: boolean;
  space: SpaceRecord;
  onClose: () => void;
}

export const ShareEmbedModal: React.FC<ShareEmbedModalProps> = ({
  open,
  space,
  onClose,
}) => {
  const [copied, setCopied] = useState<string | null>(null);
  if (!open) return null;

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : `${window.location.protocol}//${window.location.host}`
      : '';
  const shareUrl = `${origin}/?space=${encodeURIComponent(space.id)}`;
  const iframeCode = `<iframe\n  src="${shareUrl}&embed=1"\n  width="100%"\n  height="540"\n  style="border:0;border-radius:8px;"\n  allowfullscreen\n></iframe>`;
  const sdkCode = `// Install: npm install ${origin}/sdk/spacekit-sdk-1.0.0.tgz
// Or ESM:  import { SpaceKit } from '${origin}/sdk/spacekit-sdk.js';
import { SpaceKit } from '@spacekit/sdk';

const space = new SpaceKit.Space({
  spaceId: '${space.id}',
  apiKey: 'YOUR_SPACEKIT_API_KEY',
  endpoint: '${origin}/api/v1'
});
await space.startViewer({ containerId: 'spacekit-3d', mode: '3d', showAnnotations: true });`;

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white border border-[#e5e8ec] rounded-lg shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e5e8ec] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#1f242c]">
              Share &amp; embed &mdash; {space.name}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Integrate this 3D building and geospatial data via SDK, REST API, or iframe.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {space.status !== 'live' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-900">
              This space is currently set to <strong>Draft</strong>. Publish it or set status to <strong>Live</strong> in Settings so public embed URLs load cleanly.
            </div>
          )}

          <div>
            <label className="font-medium text-[#1f242c] flex items-center gap-1.5 mb-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>Public Interactive 3D Viewer URL</span>
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={`${shareUrl}&embed=1`}
                className="flex-1 bg-[#f4f6f9] border border-[#d6dce3] rounded-md px-3 py-2 font-mono text-[11px] text-[#1f242c]"
              />
              <button
                type="button"
                onClick={() => copy(`${shareUrl}&embed=1`, 'shareurl')}
                className="px-3 py-2 border border-[#d6dce3] rounded-md font-medium hover:bg-slate-50 flex items-center gap-1"
              >
                {copied === 'shareurl' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied === 'shareurl' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div>
            <label className="font-medium text-[#1f242c] flex items-center gap-1.5 mb-1.5">
              <LinkIcon className="w-3.5 h-3.5 text-slate-500" />
              <span>Direct Space ID &amp; REST Endpoint</span>
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={`${origin}/api/v1/spaces/${space.id}`}
                className="flex-1 bg-[#f4f6f9] border border-[#d6dce3] rounded-md px-3 py-2 font-mono text-[11px] text-[#1f242c]"
              />
              <button
                type="button"
                onClick={() =>
                  copy(`${origin}/api/v1/spaces/${space.id}`, 'endpoint')
                }
                className="px-3 py-2 border border-[#d6dce3] rounded-md font-medium hover:bg-slate-50 flex items-center gap-1"
              >
                {copied === 'endpoint' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied === 'endpoint' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium text-[#1f242c] flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-slate-500" />
                <span>SpaceKit JS SDK</span>
              </span>
              <div className="flex items-center gap-3">
                <a
                  href={`${origin}/sdk/spacekit-sdk-1.0.0.tgz`}
                  download="spacekit-sdk-1.0.0.tgz"
                  className="text-slate-600 hover:text-[#1f242c] font-medium flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .tgz</span>
                </a>
                <button
                  type="button"
                  onClick={() => copy(sdkCode, 'sdk')}
                  className="text-slate-600 hover:text-[#1f242c] font-medium flex items-center gap-1"
                >
                  {copied === 'sdk' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copied === 'sdk' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
            <pre className="bg-[#1a1f26] text-slate-100 rounded-md p-3 font-mono text-[11px] overflow-x-auto">
              {sdkCode}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium text-[#1f242c] flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-slate-500" />
                <span>HTML Embed Iframe</span>
              </span>
              <button
                type="button"
                onClick={() => copy(iframeCode, 'iframe')}
                className="text-slate-600 hover:text-[#1f242c] font-medium flex items-center gap-1"
              >
                {copied === 'iframe' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied === 'iframe' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="bg-[#f4f6f9] border border-[#e5e8ec] text-[#1f242c] rounded-md p-3 font-mono text-[11px] overflow-x-auto">
              {iframeCode}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
