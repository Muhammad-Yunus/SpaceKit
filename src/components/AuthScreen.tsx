import React, { useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { api, setAuthToken } from '../lib/api.ts';
import type { AuthUser } from '../types/space.ts';

interface AuthScreenProps {
  dbConfigured: boolean;
  onAuthenticated: (user: AuthUser) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  dbConfigured,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('Personal spaces');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.register({ email, password, name, workspaceName });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Authentication failed.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-md bg-white border border-[#e5e8ec] rounded-lg shadow-sm p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-[#1f242c] text-white flex items-center justify-center font-display font-bold text-lg tracking-tight">
            S
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#1f242c] leading-tight">
              SpaceKit
            </h1>
            <p className="text-xs text-slate-500">
              3D Spatial Floor Plans, Geospatial Mapping &amp; SDK
            </p>
          </div>
        </div>

        {!dbConfigured && (
          <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>
              PostgreSQL environment variables are not set yet. Configure{' '}
              <code className="font-mono">PGHOST</code>,{' '}
              <code className="font-mono">PGPORT</code>,{' '}
              <code className="font-mono">PGDATABASE</code>,{' '}
              <code className="font-mono">PGUSER</code>, and{' '}
              <code className="font-mono">PGPASSWORD</code> in Settings &gt; Secrets.
            </span>
          </div>
        )}

        <div className="flex border-b border-[#e5e8ec] gap-6 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`pb-2.5 border-b-2 transition-colors ${
              mode === 'login'
                ? 'border-[#1f242c] text-[#1f242c]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`pb-2.5 border-b-2 transition-colors ${
              mode === 'register'
                ? 'border-[#1f242c] text-[#1f242c]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Create account
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {mode === 'register' && (
            <>
              <div>
                <label className="block font-medium text-[#1f242c] mb-1">
                  Full name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full border border-[#d6dce3] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#1f242c]"
                />
              </div>
              <div>
                <label className="block font-medium text-[#1f242c] mb-1">
                  Workspace name
                </label>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Personal spaces"
                  className="w-full border border-[#d6dce3] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#1f242c]"
                />
              </div>
            </>
          )}

          <div>
            <label className="block font-medium text-[#1f242c] mb-1">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="architect@company.com"
              className="w-full border border-[#d6dce3] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#1f242c]"
            />
          </div>

          <div>
            <label className="block font-medium text-[#1f242c] mb-1">
              Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full border border-[#d6dce3] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#1f242c]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>
              {mode === 'login' ? 'Sign in to SpaceKit' : 'Create SpaceKit account'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};
