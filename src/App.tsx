import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Plus,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  AlertTriangle,
  Layers,
  Maximize,
  Tag,
  HelpCircle,
  LayoutGrid,
  Info,
  Globe,
  Database,
  FolderKanban,
  Settings,
  Eye,
  FileCode2,
  Gauge,
  Share2,
  Wrench,
  Lock,
  PencilRuler,
  Armchair,
  MapPin,
  LogOut,
  Menu,
  X,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api, setAuthToken } from './lib/api.ts';
import type {
  AuthUser,
  ProjectRecord,
  SpaceData,
  SpaceRecord,
  SpatialEntityRecord,
} from './types/space.ts';
import { AuthScreen } from './components/AuthScreen.tsx';
import { SpaceThumbnail } from './components/SpaceThumbnail.tsx';
import { Space3DViewer } from './components/Space3DViewer.tsx';
import { CadEditor2D } from './components/CadEditor2D.tsx';
import { EquipmentEditor } from './components/EquipmentEditor.tsx';
import { SpaceMapView } from './components/SpaceMapView.tsx';
import { CadUploadModal } from './components/CadUploadModal.tsx';
import { AiSpatialChat } from './components/AiSpatialChat.tsx';
import { DevelopersView } from './components/DevelopersView.tsx';
import { ShareEmbedModal } from './components/ShareEmbedModal.tsx';
import { ProjectsView, UsageView } from './components/ProjectsAndUsageViews.tsx';
import { EntitiesManagerPanel } from './components/EntitiesManagerPanel.tsx';

type TopNavTab = 'spaces' | 'projects' | 'developers' | 'usage';
type SpaceSubTab = 'profile' | 'levels' | 'location' | 'entities' | 'projects' | 'settings';
type EditModeTab = 'levels' | 'layout' | 'equipment' | 'map' | 'entities';

function renderStatusBadge(
  space: { status: string; unpublishedData?: SpaceData | null },
  variant: 'light' | 'dark' | 'card' = 'light'
) {
  const isDraftStatus = space.status !== 'live';
  const hasUnpublished = Boolean(space.unpublishedData);

  if (variant === 'dark') {
    if (isDraftStatus) {
      return (
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-500/70 text-[11px] font-medium text-slate-200">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          <span>Draft</span>
        </span>
      );
    }
    if (hasUnpublished) {
      return (
        <span
          title="Live with unpublished draft changes"
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-400/80 text-[11px] font-medium text-amber-200"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span>Live</span>
          <AlertTriangle className="w-3 h-3 text-amber-300" />
        </span>
      );
    }
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-400/70 text-[11px] font-medium text-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span>Live</span>
      </span>
    );
  }

  const positionClass =
    variant === 'card' ? 'absolute top-2.5 right-2.5 shadow-sm' : 'hidden sm:inline-flex';

  if (isDraftStatus) {
    return (
      <span
        className={`${positionClass} inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-slate-300 text-[11px] font-medium text-slate-700`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        <span>Draft</span>
      </span>
    );
  }

  if (hasUnpublished) {
    return (
      <span
        title="Live with unpublished draft changes"
        className={`${positionClass} inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-amber-400 text-[11px] font-medium text-[#1f242c]`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        <span>Live</span>
        <AlertTriangle className="w-3 h-3 text-amber-500" />
      </span>
    );
  }

  return (
    <span
      className={`${positionClass} inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-emerald-500 text-[11px] font-medium text-[#1f242c]`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      <span>Live</span>
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

export default function App() {
  const [healthChecked, setHealthChecked] = useState(false);
  const [dbConfigured, setDbConfigured] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  const [topTab, setTopTab] = useState<TopNavTab>('spaces');
  const [spaces, setSpaces] = useState<SpaceRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);

  // Dashboard controls
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'live' | 'geolocated'>('all');
  const [sortMode, setSortMode] = useState<'updated' | 'sqft' | 'views'>('updated');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceNameInput, setWorkspaceNameInput] = useState('');
  const [savingWorkspaceName, setSavingWorkspaceName] = useState(false);

  // Active space & view/edit states
  const [activeSpace, setActiveSpace] = useState<SpaceRecord | null>(null);
  const [spaceSubTab, setSpaceSubTab] = useState<SpaceSubTab>('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [editMode, setEditMode] = useState<EditModeTab>('layout');
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Spatial entities state
  const [entities, setEntities] = useState<SpatialEntityRecord[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [pickedFloorPoint, setPickedFloorPoint] = useState<{ x: number; z: number } | null>(null);

  // Public embed mode (?space=<id>&embed=1)
  const initialQuery = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      spaceId: params.get('space')?.trim() || null,
      isEmbed: params.get('embed') === '1',
    };
  }, []);
  const deepLinkHandledRef = useRef(false);

  const [publicEmbed, setPublicEmbed] = useState<{
    loading: boolean;
    error: string | null;
    space: {
      id: string;
      name: string;
      description: string;
      status: string;
      tags: string[];
      sqft: number;
      views: number;
      complexity: number;
      address: string | null;
      latitude: number | null;
      longitude: number | null;
      data: SpaceData;
      updatedAt: string;
    } | null;
    entities: SpatialEntityRecord[];
  }>({
    loading: Boolean(initialQuery.isEmbed && initialQuery.spaceId),
    error: null,
    space: null,
    entities: [],
  });
  const [embedSelectedEntityId, setEmbedSelectedEntityId] = useState<string | null>(null);

  // Global notice banner
  const [notice, setNotice] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((type: 'error' | 'success', message: string) => {
    setNotice({ type, message });
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 4500);
  }, []);

  // Draft state for editor
  const [draftData, setDraftData] = useState<SpaceData | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const saveTimerRef = useRef<number | null>(null);

  // Modals & Drawers
  const [cadModalOpen, setCadModalOpen] = useState(false);
  const [cadModalTargetSpaceId, setCadModalTargetSpaceId] = useState<string | undefined>(undefined);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Tag inline editor
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // Profile inline edit & settings confirmation
  const [editingName, setEditingName] = useState('');
  const [editingDesc, setEditingDesc] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmDeleteSpace, setConfirmDeleteSpace] = useState(false);

  const snapshotFnRef = useRef<(() => string | null) | null>(null);

  useEffect(() => {
    api
      .health()
      .then((res) => {
        setDbConfigured(res.dbConfigured);
      })
      .catch(() => {})
      .finally(() => setHealthChecked(true));
  }, []);

  useEffect(() => {
    if (!initialQuery.isEmbed || !initialQuery.spaceId) return;
    let cancelled = false;
    setPublicEmbed((prev) => ({ ...prev, loading: true, error: null }));
    api
      .getPublicSpace(initialQuery.spaceId)
      .then((res) => {
        if (cancelled) return;
        setPublicEmbed({
          loading: false,
          error: null,
          space: res.space,
          entities: res.entities,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setPublicEmbed({
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : 'This public 3D space is unavailable or set to Draft.',
          space: null,
          entities: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [initialQuery]);

  useEffect(() => {
    if (user) {
      setWorkspaceNameInput(user.workspaceName);
    }
  }, [user]);

  const loadWorkspaceData = useCallback(async () => {
    setLoadingSpaces(true);
    try {
      const [spRes, prRes] = await Promise.all([
        api.listSpaces(),
        api.listProjects(),
      ]);
      setSpaces(spRes.spaces);
      setProjects(prRes.projects);
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to load workspace data.'
      );
    } finally {
      setLoadingSpaces(false);
    }
  }, [showNotice]);

  useEffect(() => {
    if (user) {
      loadWorkspaceData();
    }
  }, [user, loadWorkspaceData]);

  const openSpace = useCallback(
    async (space: SpaceRecord) => {
      setActiveSpace(space);
      setSpaceSubTab('profile');
      setIsEditing(false);
      setConfirmDeleteSpace(false);
      setDraftData(space.unpublishedData ?? space.data);
      setEditingName(space.name);
      setEditingDesc(space.description);
      setEntities([]);
      setSelectedEntityId(null);
      setPickedFloorPoint(null);

      try {
        const [spaceRes, entitiesRes] = await Promise.all([
          api.getSpace(space.id),
          api.listEntities(space.id),
        ]);
        setActiveSpace(spaceRes.space);
        setDraftData(spaceRes.space.unpublishedData ?? spaceRes.space.data);
        setEditingName(spaceRes.space.name);
        setEditingDesc(spaceRes.space.description);
        setEntities(entitiesRes.entities);
        setSpaces((prev) =>
          prev.map((s) => (s.id === spaceRes.space.id ? spaceRes.space : s))
        );
      } catch (err) {
        showNotice(
          'error',
          err instanceof Error ? err.message : 'Failed to refresh space details.'
        );
      }
    },
    [showNotice]
  );

  useEffect(() => {
    if (
      !user ||
      initialQuery.isEmbed ||
      !initialQuery.spaceId ||
      deepLinkHandledRef.current ||
      spaces.length === 0
    ) {
      return;
    }
    const target = spaces.find((s) => s.id === initialQuery.spaceId);
    if (target) {
      deepLinkHandledRef.current = true;
      openSpace(target);
    }
  }, [user, initialQuery, spaces, openSpace]);

  const captureThumbnailIfNeeded = async (space: SpaceRecord) => {
    if (!snapshotFnRef.current) return;
    const snap = snapshotFnRef.current();
    if (!snap) return;
    try {
      const res = await api.updateSpace(space.id, { thumbnailUrl: snap });
      setActiveSpace(res.space);
      setSpaces((prev) =>
        prev.map((s) => (s.id === res.space.id ? res.space : s))
      );
    } catch {
      // non-fatal
    }
  };

  const handleDraftChange = (nextData: SpaceData) => {
    setDraftData(nextData);
    if (!activeSpace) return;
    if (activeSpace.locked) {
      showNotice('error', 'This space is locked. Unlock it before saving edits.');
      return;
    }
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(async () => {
      setIsSavingDraft(true);
      try {
        const res = await api.updateSpace(activeSpace.id, {
          unpublishedData: nextData,
        });
        setActiveSpace(res.space);
        setSpaces((prev) =>
          prev.map((s) => (s.id === res.space.id ? res.space : s))
        );
      } catch (err) {
        showNotice(
          'error',
          err instanceof Error ? err.message : 'Failed to sync draft changes.'
        );
      } finally {
        setIsSavingDraft(false);
      }
    }, 600);
  };

  const handlePublish = async () => {
    if (!activeSpace) return;
    try {
      const res = await api.publishSpace(activeSpace.id);
      setActiveSpace(res.space);
      setDraftData(res.space.data);
      setSpaces((prev) =>
        prev.map((s) => (s.id === res.space.id ? res.space : s))
      );
      showNotice('success', 'Published latest changes live.');
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to publish changes.'
      );
    }
  };

  const handleDiscard = async () => {
    if (!activeSpace) return;
    try {
      const res = await api.discardSpace(activeSpace.id);
      setActiveSpace(res.space);
      setDraftData(res.space.data);
      setSpaces((prev) =>
        prev.map((s) => (s.id === res.space.id ? res.space : s))
      );
      showNotice('success', 'Discarded unpublished draft changes.');
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to discard changes.'
      );
    }
  };

  const handleToggleLock = async () => {
    if (!activeSpace) return;
    try {
      const res = await api.updateSpace(activeSpace.id, {
        locked: !activeSpace.locked,
      });
      setActiveSpace(res.space);
      setSpaces((prev) =>
        prev.map((s) => (s.id === res.space.id ? res.space : s))
      );
      showNotice(
        'success',
        res.space.locked ? 'Space locked against edits.' : 'Space unlocked.'
      );
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update lock status.'
      );
    }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpace || !tagInput.trim()) return;
    const nextTags = Array.from(
      new Set([...(activeSpace.tags || []), tagInput.trim()])
    );
    try {
      const res = await api.updateSpace(activeSpace.id, { tags: nextTags });
      setActiveSpace(res.space);
      setSpaces((prev) =>
        prev.map((s) => (s.id === res.space.id ? res.space : s))
      );
      setTagInput('');
      setAddingTag(false);
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to add tag.'
      );
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!activeSpace) return;
    const nextTags = activeSpace.tags.filter((t) => t !== tag);
    try {
      const res = await api.updateSpace(activeSpace.id, { tags: nextTags });
      setActiveSpace(res.space);
      setSpaces((prev) =>
        prev.map((s) => (s.id === res.space.id ? res.space : s))
      );
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to remove tag.'
      );
    }
  };

  const handleSaveWorkspaceName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceNameInput.trim()) return;
    setSavingWorkspaceName(true);
    try {
      const res = await api.updateWorkspaceName(workspaceNameInput.trim());
      setUser(res.user);
      setWorkspaceMenuOpen(false);
      showNotice('success', 'Workspace name updated.');
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to rename workspace.'
      );
    } finally {
      setSavingWorkspaceName(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setSpaces([]);
    setProjects([]);
    setEntities([]);
    setActiveSpace(null);
    setWorkspaceMenuOpen(false);
    setUserMenuOpen(false);
  };

  const filteredSpaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return spaces
      .filter((s) => {
        if (filterMode === 'live' && s.status !== 'live') return false;
        if (filterMode === 'geolocated' && (s.latitude === null || s.longitude === null))
          return false;
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortMode === 'sqft') return b.sqft - a.sqft;
        if (sortMode === 'views') return b.views - a.views;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [spaces, searchQuery, filterMode, sortMode]);

  const totalSqft = useMemo(
    () => spaces.reduce((acc, s) => acc + s.sqft, 0),
    [spaces]
  );
  const totalViews = useMemo(
    () => spaces.reduce((acc, s) => acc + s.views, 0),
    [spaces]
  );

  const noticeBanner = notice ? (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md shadow-lg border text-xs font-medium flex items-center gap-2 ${
        notice.type === 'error'
          ? 'bg-red-50 border-red-300 text-red-700'
          : 'bg-emerald-50 border-emerald-300 text-emerald-800'
      }`}
    >
      {notice.type === 'error' ? (
        <AlertCircle className="w-4 h-4 shrink-0" />
      ) : (
        <CheckCircle2 className="w-4 h-4 shrink-0" />
      )}
      <span>{notice.message}</span>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="ml-1 opacity-70 hover:opacity-100"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : null;

  // Public interactive 3D embed view (?space=<id>&embed=1)
  if (initialQuery.isEmbed && initialQuery.spaceId) {
    if (publicEmbed.loading) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-[#cfd7df] text-xs text-slate-700">
          Loading SpaceKit 3D scene...
        </div>
      );
    }
    if (publicEmbed.error || !publicEmbed.space) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-[#f4f6f9] p-6">
          <div className="bg-white border border-[#e5e8ec] rounded-lg p-6 max-w-md text-center space-y-3">
            <div className="w-10 h-10 rounded bg-[#1f242c] text-white flex items-center justify-center font-bold mx-auto">
              S
            </div>
            <h1 className="text-base font-semibold text-[#1f242c]">
              3D Embed Unavailable
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {publicEmbed.error ||
                'This space does not exist or is currently set to Draft.'}
            </p>
            <a
              href="/"
              className="inline-block px-3.5 py-1.5 bg-[#1f242c] text-white rounded-md text-xs font-medium"
            >
              Open SpaceKit Console
            </a>
          </div>
        </div>
      );
    }

    const embedSpace = publicEmbed.space;
    return (
      <div className="h-screen w-screen relative bg-[#cfd7df] overflow-hidden">
        <Space3DViewer
          data={embedSpace.data}
          entities={publicEmbed.entities}
          selectedEntityId={embedSelectedEntityId}
          onSelectEntity={setEmbedSelectedEntityId}
        />
        <div className="absolute top-3 left-3 z-20 bg-white/95 backdrop-blur border border-[#e5e8ec] rounded-md px-3 py-2 shadow-sm flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-[#1f242c] text-white flex items-center justify-center text-xs font-bold shrink-0">
            S
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#1f242c] truncate max-w-[200px]">
              {embedSpace.name}
            </div>
            <div className="text-[10px] text-slate-500 tabular-nums">
              {embedSpace.sqft.toLocaleString()} sqft · {embedSpace.data.levels.length}{' '}
              {embedSpace.data.levels.length === 1 ? 'level' : 'levels'}
              {publicEmbed.entities.length > 0
                ? ` · ${publicEmbed.entities.length} entities`
                : ''}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!healthChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-xs text-slate-500">
        Initializing SpaceKit...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        dbConfigured={dbConfigured}
        onAuthenticated={(authUser) => setUser(authUser)}
      />
    );
  }

  // ---------------- DARK EDITOR HEADER & BODY (Screenshots 3, 4, 7) ----------------
  if (activeSpace && isEditing) {
    const currentData = draftData ?? activeSpace.unpublishedData ?? activeSpace.data;
    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#1a1f26]">
        <header className="h-14 shrink-0 bg-[#1a1f26] text-white border-b border-white/10 px-4 flex items-center justify-between gap-4">
          {/* Left breadcrumb */}
          <div className="flex items-center gap-2 text-xs min-w-0">
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setActiveSpace(null);
              }}
              className="flex items-center gap-1.5 text-slate-300 hover:text-white whitespace-nowrap"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>All spaces</span>
            </button>
            <span className="text-slate-600">/</span>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="flex items-center gap-1.5 text-slate-300 hover:text-white truncate max-w-[160px]"
            >
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{activeSpace.name}</span>
            </button>
            <span className="text-slate-600">/</span>
            <span className="flex items-center gap-1.5 font-medium text-white whitespace-nowrap">
              <Wrench className="w-3.5 h-3.5" />
              <span>Edit</span>
            </span>
          </div>

          {/* Center 5 mode icons matching Screenshot 3, 4, 7 */}
          <nav className="hidden md:flex items-center gap-1.5">
            {[
              { id: 'levels', icon: Layers, title: 'Stack levels' },
              { id: 'layout', icon: PencilRuler, title: 'Edit layout' },
              { id: 'equipment', icon: Armchair, title: 'Add equipment' },
              { id: 'map', icon: Globe, title: 'Place on map' },
              { id: 'entities', icon: Database, title: 'Manage entities' },
            ].map((m) => {
              const Icon = m.icon;
              const active = editMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setEditMode(m.id as EditModeTab)}
                  title={m.title}
                  className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
                    active
                      ? 'bg-[#2f3744] text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            {renderStatusBadge(activeSpace, 'dark')}

            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="px-3 py-1.5 rounded-md border border-white/20 text-xs font-medium text-white hover:bg-white/10 whitespace-nowrap"
            >
              Share &amp; embed
            </button>

            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setSpaceSubTab('profile');
              }}
              className="px-3.5 py-1.5 rounded-md bg-white text-[#1a1f26] hover:bg-slate-100 text-xs font-semibold whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </header>

        {/* Active Editor Body */}
        {editMode === 'layout' && (
          <CadEditor2D
            space={activeSpace}
            draftData={currentData}
            onChangeDraft={handleDraftChange}
            onPublish={handlePublish}
            onDiscard={handleDiscard}
            onOpenCadUpload={() => {
              setCadModalTargetSpaceId(activeSpace.id);
              setCadModalOpen(true);
            }}
            onOpenAiChat={() => setAiChatOpen(true)}
            onFullPreview={() => {
              setIsEditing(false);
              setSpaceSubTab('profile');
            }}
            isSaving={isSavingDraft}
          />
        )}

        {editMode === 'equipment' && (
          <EquipmentEditor
            draftData={currentData}
            onChangeDraft={handleDraftChange}
            onOpenAiChat={() => setAiChatOpen(true)}
          />
        )}

        {editMode === 'map' && (
          <SpaceMapView
            space={activeSpace}
            data={currentData}
            mode="edit"
            onSaveLocation={async (locPatch) => {
              const res = await api.updateSpace(activeSpace.id, locPatch);
              setActiveSpace(res.space);
              setSpaces((prev) =>
                prev.map((s) => (s.id === res.space.id ? res.space : s))
              );
              showNotice('success', 'Geolocation saved to PostgreSQL.');
            }}
            onFinishWizard={() => {
              setIsEditing(false);
              setSpaceSubTab('location');
            }}
          />
        )}

        {editMode === 'levels' && (
          <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden bg-[#eef2f6]">
            <aside className="w-full lg:w-[380px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-[#e5e8ec] p-5 overflow-y-auto space-y-4 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-[#eef1f5]">
                <div>
                  <h3 className="text-sm font-semibold text-[#1f242c]">
                    Stack building levels
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Configure multi-story elevations, floor heights, and names.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={activeSpace.locked}
                  onClick={() => {
                    const idx = currentData.levels.length + 1;
                    const maxElev = currentData.levels.reduce(
                      (m, l) => Math.max(m, l.elevation + (l.floorHeight || 2.8)),
                      0
                    );
                    handleDraftChange({
                      ...currentData,
                      levels: [
                        ...currentData.levels,
                        {
                          id: `level_${Date.now().toString(36)}`,
                          name: `Level ${idx}`,
                          elevation: Number(maxElev.toFixed(2)),
                          floorHeight: 2.8,
                          walls: [],
                          doors: [],
                          windows: [],
                          rooms: [],
                          equipment: [],
                          annotations: [],
                          stairs: [],
                        },
                      ],
                    });
                  }}
                  className="px-2.5 py-1.5 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md font-medium shrink-0 disabled:opacity-45"
                >
                  + Add level
                </button>
              </div>

              <div className="space-y-3">
                {currentData.levels.map((lvl, idx) => (
                  <div
                    key={lvl.id}
                    className="p-3 border border-[#e5e8ec] rounded-md space-y-2.5 bg-[#f8fafc]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={lvl.name}
                        disabled={activeSpace.locked}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleDraftChange({
                            ...currentData,
                            levels: currentData.levels.map((item) =>
                              item.id === lvl.id ? { ...item, name: val } : item
                            ),
                          });
                        }}
                        className="font-semibold text-[#1f242c] bg-white border border-[#d6dce3] rounded px-2 py-1 flex-1 min-w-0"
                      />
                      {currentData.levels.length > 1 && (
                        <button
                          type="button"
                          disabled={activeSpace.locked}
                          onClick={() => {
                            handleDraftChange({
                              ...currentData,
                              levels: currentData.levels.filter(
                                (item) => item.id !== lvl.id
                              ),
                            });
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-40"
                          title={`Delete ${lvl.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">
                          Elevation (m)
                        </label>
                        <input
                          type="number"
                          step="0.2"
                          disabled={activeSpace.locked}
                          value={lvl.elevation}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            handleDraftChange({
                              ...currentData,
                              levels: currentData.levels.map((item) =>
                                item.id === lvl.id
                                  ? { ...item, elevation: val }
                                  : item
                              ),
                            });
                          }}
                          className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">
                          Wall height (m)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="1.5"
                          max="12"
                          disabled={activeSpace.locked}
                          value={lvl.floorHeight || 2.8}
                          onChange={(e) => {
                            const val = Math.max(
                              1.5,
                              Number(e.target.value) || 2.8
                            );
                            handleDraftChange({
                              ...currentData,
                              levels: currentData.levels.map((item) =>
                                item.id === lvl.id
                                  ? { ...item, floorHeight: val }
                                  : item
                              ),
                            });
                          }}
                          className="w-full bg-white border border-[#d6dce3] rounded px-2 py-1 tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500 tabular-nums">
                      Floor #{idx + 1} · {lvl.walls.length} walls ·{' '}
                      {lvl.doors.length} doors · {lvl.equipment.length} equipment
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            <div className="relative flex-1 min-h-[320px] bg-[#cfd7df]">
              <Space3DViewer data={currentData} entities={entities} />
            </div>
          </div>
        )}

        {editMode === 'entities' && (
          <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden bg-[#eef2f6]">
            <aside className="w-full lg:w-[380px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-[#e5e8ec] p-5 overflow-y-auto">
              <EntitiesManagerPanel
                spaceId={activeSpace.id}
                levels={currentData.levels}
                entities={entities}
                selectedEntityId={selectedEntityId}
                onSelectEntity={setSelectedEntityId}
                onEntitiesChange={setEntities}
                pickedPoint={pickedFloorPoint}
                locked={activeSpace.locked}
                onError={(msg) => showNotice('error', msg)}
              />
            </aside>
            <div className="relative flex-1 min-h-[320px] bg-[#cfd7df]">
              <Space3DViewer
                data={currentData}
                entities={entities}
                selectedEntityId={selectedEntityId}
                onSelectEntity={setSelectedEntityId}
                onPickFloorPoint={(x, z) => setPickedFloorPoint({ x, z })}
              />
            </div>
          </div>
        )}

        <CadUploadModal
          open={cadModalOpen}
          targetSpaceId={cadModalTargetSpaceId}
          onClose={() => setCadModalOpen(false)}
          onSpaceReady={(updated) => {
            setActiveSpace(updated);
            setDraftData(updated.unpublishedData ?? updated.data);
            setSpaces((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s))
            );
          }}
        />

        <AiSpatialChat
          open={aiChatOpen}
          space={activeSpace}
          onClose={() => setAiChatOpen(false)}
          onSpaceUpdated={(updated) => {
            setActiveSpace(updated);
            setDraftData(updated.unpublishedData ?? updated.data);
            setSpaces((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s))
            );
          }}
        />

        <ShareEmbedModal
          open={shareOpen}
          space={activeSpace}
          onClose={() => setShareOpen(false)}
        />
        {noticeBanner}
      </div>
    );
  }

  // ---------------- SPACE PROFILE / LOCATION VIEW (Screenshots 2, 5, 6) ----------------
  if (activeSpace) {
    const viewData = activeSpace.unpublishedData ?? activeSpace.data;
    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-white">
        {/* Top Light Header matching Screenshot 2 */}
        <header className="h-14 shrink-0 bg-white border-b border-[#e5e8ec] px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              className="md:hidden p-1.5 rounded hover:bg-slate-100"
            >
              <Menu className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                captureThumbnailIfNeeded(activeSpace);
                setActiveSpace(null);
              }}
              className="flex items-center gap-1.5 text-slate-600 hover:text-[#1f242c] whitespace-nowrap"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>All spaces</span>
            </button>
            <span className="text-slate-300">/</span>
            <span className="flex items-center gap-1.5 text-slate-700 truncate max-w-[160px]">
              <Building2 className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              <span className="truncate">{activeSpace.name}</span>
            </span>
            <span className="text-slate-300">/</span>
            <span className="flex items-center gap-1.5 font-medium text-[#1f242c] capitalize whitespace-nowrap">
              <Info className="w-3.5 h-3.5 text-slate-500" />
              <span>{spaceSubTab}</span>
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 relative">
            {renderStatusBadge(activeSpace, 'light')}

            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="px-3 py-1.5 border border-[#d6dce3] rounded-md text-xs font-medium text-[#1f242c] hover:bg-slate-50 whitespace-nowrap"
            >
              Share &amp; embed
            </button>

            <button
              type="button"
              onClick={() => setEditMenuOpen((v) => !v)}
              className="px-3.5 py-1.5 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>Edit</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {/* Edit Dropdown Menu matching Screenshot 6 */}
            {editMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setEditMenuOpen(false)}
                />
                <div className="absolute right-0 top-11 z-40 w-[440px] max-w-[92vw] bg-white border border-[#dce1e7] rounded-lg shadow-xl grid grid-cols-2 overflow-hidden">
                  <div className="bg-[#f4f6f9] p-4 space-y-5 border-r border-[#e5e8ec]">
                    <div className="space-y-1.5">
                      <Wrench className="w-4 h-4 text-slate-600" />
                      <h4 className="text-xs font-semibold text-[#1f242c]">
                        Explore all editing tools
                      </h4>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Learn more about each tool and start digitizing step by step
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setEditMenuOpen(false);
                          setEditMode('layout');
                          setIsEditing(true);
                        }}
                        className="text-[11px] font-medium text-[#1f242c] underline"
                      >
                        Open the edit toolbox
                      </button>
                    </div>

                    <div className="pt-4 border-t border-[#e5e8ec] space-y-2">
                      <Lock className="w-4 h-4 text-slate-600" />
                      <h4 className="text-xs font-semibold text-[#1f242c]">
                        Lock the space
                      </h4>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Turn the option on to prevent changes to this space
                      </p>
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={activeSpace.locked}
                          onChange={handleToggleLock}
                          className="sr-only peer"
                        />
                        <span className="w-8 h-4.5 bg-slate-300 peer-checked:bg-[#1f242c] rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-3.5 after:h-3.5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-3.5" />
                      </label>
                    </div>
                  </div>

                  <div className="p-2 flex flex-col justify-between text-xs">
                    {[
                      {
                        mode: 'levels' as EditModeTab,
                        icon: Layers,
                        title: 'Stack levels',
                        desc: 'Upload and stack floor plans',
                      },
                      {
                        mode: 'layout' as EditModeTab,
                        icon: PencilRuler,
                        title: 'Edit layout',
                        desc: 'Trace over to digitize floor plans',
                      },
                      {
                        mode: 'equipment' as EditModeTab,
                        icon: Armchair,
                        title: 'Add equipment',
                        desc: 'Position furniture, machinery, etc.',
                      },
                      {
                        mode: 'map' as EditModeTab,
                        icon: Globe,
                        title: 'Place on map',
                        desc: 'Locate the space in the world',
                      },
                      {
                        mode: 'entities' as EditModeTab,
                        icon: Database,
                        title: 'Manage entities',
                        desc: 'Position data items on the space',
                      },
                    ].map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => {
                            setEditMenuOpen(false);
                            setEditMode(item.mode);
                            setIsEditing(true);
                          }}
                          className="w-full text-left p-2.5 rounded-md hover:bg-[#f4f6f9] flex items-start gap-2.5 transition-colors"
                        >
                          <Icon className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                          <div>
                            <div className="font-medium text-[#1f242c]">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {item.desc}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          {/* Left Navigation Sidebar matching Screenshot 2 */}
          <aside
            className={`${
              mobileSidebarOpen ? 'flex absolute inset-y-0 left-0 z-30' : 'hidden md:flex'
            } w-52 shrink-0 bg-white border-r border-[#e5e8ec] flex-col justify-between`}
          >
            <div className="p-3 space-y-1 text-xs">
              {[
                { id: 'profile', label: 'Profile', icon: Info },
                { id: 'levels', label: 'Levels', icon: Layers },
                { id: 'location', label: 'Location', icon: Globe },
                { id: 'entities', label: 'Entities', icon: Database, count: entities.length },
              ].map((nav) => {
                const Icon = nav.icon;
                const active = spaceSubTab === nav.id;
                return (
                  <button
                    key={nav.id}
                    type="button"
                    onClick={() => {
                      setSpaceSubTab(nav.id as SpaceSubTab);
                      setMobileSidebarOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors ${
                      active
                        ? 'bg-[#eef2f5] text-[#1f242c] font-medium'
                        : 'text-[#3b434f] hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{nav.label}</span>
                    </span>
                    {typeof nav.count === 'number' && nav.count > 0 && (
                      <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded tabular-nums">
                        {nav.count}
                      </span>
                    )}
                  </button>
                );
              })}

              <div className="my-2 border-t border-[#eef1f5]" />

              <button
                type="button"
                onClick={() => {
                  setSpaceSubTab('projects');
                  setMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors ${
                  spaceSubTab === 'projects'
                    ? 'bg-[#eef2f5] text-[#1f242c] font-medium'
                    : 'text-[#3b434f] hover:bg-slate-50'
                }`}
              >
                <FolderKanban className="w-4 h-4" />
                <span>Projects</span>
              </button>

              <div className="my-2 border-t border-[#eef1f5]" />

              <button
                type="button"
                onClick={() => {
                  setSpaceSubTab('settings');
                  setMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors ${
                  spaceSubTab === 'settings'
                    ? 'bg-[#eef2f5] text-[#1f242c] font-medium'
                    : 'text-[#3b434f] hover:bg-slate-50'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
            </div>

            <div className="p-3 border-t border-[#e5e8ec] flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[#1f242c] text-white flex items-center justify-center text-xs font-semibold shrink-0">
                {user.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[#1f242c] truncate">
                  {user.email}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {user.workspaceName}
                </div>
              </div>
            </div>
          </aside>

          {/* Sub-view content */}
          {spaceSubTab === 'location' ? (
            <SpaceMapView
              space={activeSpace}
              data={viewData}
              mode="view"
              onStartPlaceOnMap={() => {
                setEditMode('map');
                setIsEditing(true);
              }}
              onSaveLocation={async (locPatch) => {
                const res = await api.updateSpace(activeSpace.id, locPatch);
                setActiveSpace(res.space);
                setSpaces((prev) =>
                  prev.map((s) => (s.id === res.space.id ? res.space : s))
                );
                showNotice('success', 'Geolocation saved to PostgreSQL.');
              }}
            />
          ) : (
            <div className="flex-1 flex flex-col lg:flex-row min-w-0 overflow-hidden">
              {/* Detail Panel matching Screenshot 2 */}
              <section className="w-full lg:w-[360px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-[#e5e8ec] overflow-y-auto p-5 space-y-5">
                {spaceSubTab === 'profile' && (
                  <>
                    <div className="flex items-center justify-between pb-4 border-b border-[#eef1f5]">
                      <h2 className="text-sm font-medium text-[#1f242c]">
                        Space profile
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setEditMode('layout');
                          setIsEditing(true);
                        }}
                        className="px-3 py-1.5 border border-[#d6dce3] rounded-md text-xs font-medium text-[#1f242c] hover:bg-slate-50 flex items-center gap-1.5"
                      >
                        <PencilRuler className="w-3.5 h-3.5 text-slate-500" />
                        <span>Edit layout</span>
                      </button>
                    </div>

                    <div>
                      <h1 className="text-2xl font-normal text-[#1f242c]">
                        {activeSpace.name}
                      </h1>
                      <p className="text-xs text-slate-500 mt-1.5">
                        {activeSpace.address || 'No address was set yet'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Created {formatRelativeTime(activeSpace.createdAt)}
                      </p>
                    </div>

                    {/* 2-col Metrics Grid matching Screenshot 2 */}
                    <div className="grid grid-cols-2 gap-y-4 gap-x-3 pt-1">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded bg-[#f1f4f7] flex items-center justify-center text-slate-600 shrink-0">
                          <Maximize className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">
                            Digitized area
                          </div>
                          <div className="text-xs font-semibold text-[#1f242c] tabular-nums">
                            {activeSpace.sqft.toLocaleString()} sqft
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded bg-[#f1f4f7] flex items-center justify-center text-slate-600 shrink-0">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">Levels</div>
                          <div className="text-xs font-semibold text-[#1f242c] tabular-nums">
                            {viewData.levels.length}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded bg-[#f1f4f7] flex items-center justify-center text-slate-600 shrink-0">
                          <Eye className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">Views</div>
                          <div className="text-xs font-semibold text-[#1f242c] tabular-nums">
                            {activeSpace.views.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded bg-[#f1f4f7] flex items-center justify-center text-slate-600 shrink-0">
                          <FileCode2 className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">Size</div>
                          <div className="text-xs font-semibold text-[#1f242c] tabular-nums">
                            {activeSpace.sizeKb} kb
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded bg-[#f1f4f7] flex items-center justify-center text-slate-600 shrink-0">
                          <Gauge className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">
                            Complexity
                          </div>
                          <div className="text-xs font-semibold text-[#1f242c] tabular-nums">
                            {activeSpace.complexity}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-[#eef1f5] text-xs text-slate-600 leading-relaxed">
                      {activeSpace.description ||
                        'No description added yet. You can edit details in Settings.'}
                    </div>

                    <div className="pt-4 border-t border-[#eef1f5] space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Tag className="w-4 h-4 text-slate-400" />
                        {activeSpace.tags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#f1f4f7] text-[#1f242c] rounded text-[11px]"
                          >
                            {t}
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(t)}
                              className="text-slate-400 hover:text-slate-700"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}

                        {addingTag ? (
                          <form onSubmit={handleAddTag} className="inline-flex gap-1">
                            <input
                              type="text"
                              autoFocus
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              placeholder="Tag name"
                              className="w-24 border border-[#d6dce3] rounded px-2 py-0.5 text-xs"
                            />
                            <button
                              type="submit"
                              className="px-2 py-0.5 bg-[#1f242c] text-white rounded text-[11px]"
                            >
                              Add
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAddingTag(true)}
                            className="px-2.5 py-1 border border-[#d6dce3] rounded text-xs text-slate-600 hover:text-[#1f242c] hover:bg-slate-50"
                          >
                            Add tags
                          </button>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-500">
                        You edited {formatRelativeTime(activeSpace.updatedAt)}
                      </p>
                    </div>
                  </>
                )}

                {spaceSubTab === 'levels' && (
                  <div className="space-y-4 text-xs">
                    <div className="flex items-center justify-between pb-3 border-b border-[#eef1f5]">
                      <h2 className="text-sm font-medium text-[#1f242c]">Levels</h2>
                      <button
                        type="button"
                        onClick={() => {
                          setEditMode('levels');
                          setIsEditing(true);
                        }}
                        className="px-3 py-1.5 border border-[#d6dce3] rounded-md font-medium"
                      >
                        Manage levels
                      </button>
                    </div>
                    {viewData.levels.map((lvl) => (
                      <div
                        key={lvl.id}
                        className="p-3 border border-[#e5e8ec] rounded-md space-y-1"
                      >
                        <div className="font-semibold text-[#1f242c]">{lvl.name}</div>
                        <div className="text-slate-500 tabular-nums">
                          Elevation +{lvl.elevation}m · {lvl.walls.length} walls ·{' '}
                          {lvl.equipment.length} equipment
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {spaceSubTab === 'entities' && (
                  <EntitiesManagerPanel
                    spaceId={activeSpace.id}
                    levels={viewData.levels}
                    entities={entities}
                    selectedEntityId={selectedEntityId}
                    onSelectEntity={setSelectedEntityId}
                    onEntitiesChange={setEntities}
                    pickedPoint={pickedFloorPoint}
                    locked={activeSpace.locked}
                    onError={(msg) => showNotice('error', msg)}
                  />
                )}

                {spaceSubTab === 'projects' && (
                  <div className="space-y-4 text-xs">
                    <h2 className="text-sm font-medium text-[#1f242c] pb-3 border-b border-[#eef1f5]">
                      Assign to project
                    </h2>
                    <select
                      value={activeSpace.projectId || ''}
                      onChange={async (e) => {
                        try {
                          const res = await api.updateSpace(activeSpace.id, {
                            projectId: e.target.value || null,
                          });
                          setActiveSpace(res.space);
                          setSpaces((prev) =>
                            prev.map((s) => (s.id === res.space.id ? res.space : s))
                          );
                          api
                            .listProjects()
                            .then((pr) => setProjects(pr.projects))
                            .catch(() => {});
                          showNotice('success', 'Project assignment updated.');
                        } catch (err) {
                          showNotice(
                            'error',
                            err instanceof Error
                              ? err.message
                              : 'Failed to assign project.'
                          );
                        }
                      }}
                      className="w-full border border-[#d6dce3] rounded-md px-3 py-2"
                    >
                      <option value="">No project assigned</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.environment})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {spaceSubTab === 'settings' && (
                  <div className="space-y-4 text-xs">
                    <h2 className="text-sm font-medium text-[#1f242c] pb-3 border-b border-[#eef1f5]">
                      Space settings
                    </h2>
                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="w-full border border-[#d6dce3] rounded-md px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Description
                      </label>
                      <textarea
                        rows={3}
                        value={editingDesc}
                        onChange={(e) => setEditingDesc(e.target.value)}
                        className="w-full border border-[#d6dce3] rounded-md px-3 py-2"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-600 mb-1">
                        Visibility status
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['live', 'draft'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await api.updateSpace(
                                  activeSpace.id,
                                  { status: st }
                                );
                                setActiveSpace(res.space);
                                setSpaces((prev) =>
                                  prev.map((s) =>
                                    s.id === res.space.id ? res.space : s
                                  )
                                );
                                showNotice(
                                  'success',
                                  st === 'live'
                                    ? 'Space is now Live for public embeds.'
                                    : 'Space switched to Draft.'
                                );
                              } catch (err) {
                                showNotice(
                                  'error',
                                  err instanceof Error
                                    ? err.message
                                    : 'Failed to update status.'
                                );
                              }
                            }}
                            className={`py-2 px-3 rounded-md border font-medium capitalize transition-colors ${
                              activeSpace.status === st
                                ? 'bg-[#1f242c] text-white border-[#1f242c]'
                                : 'bg-white text-slate-600 border-[#d6dce3] hover:bg-slate-50'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={savingSettings}
                      onClick={async () => {
                        setSavingSettings(true);
                        try {
                          const res = await api.updateSpace(activeSpace.id, {
                            name: editingName,
                            description: editingDesc,
                          });
                          setActiveSpace(res.space);
                          setSpaces((prev) =>
                            prev.map((s) =>
                              s.id === res.space.id ? res.space : s
                            )
                          );
                          showNotice('success', 'Space settings saved.');
                        } catch (err) {
                          showNotice(
                            'error',
                            err instanceof Error
                              ? err.message
                              : 'Failed to save space settings.'
                          );
                        } finally {
                          setSavingSettings(false);
                        }
                      }}
                      className="w-full py-2 bg-[#1f242c] text-white rounded-md font-medium disabled:opacity-50"
                    >
                      {savingSettings ? 'Saving...' : 'Save changes'}
                    </button>

                    <div className="pt-4 border-t border-[#eef1f5]">
                      {confirmDeleteSpace ? (
                        <div className="p-3 border border-red-200 bg-red-50 rounded-md space-y-2">
                          <p className="text-[11px] font-medium text-red-700">
                            Permanently delete &ldquo;{activeSpace.name}&rdquo; and all
                            its 3D geometry &amp; entities?
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await api.deleteSpace(activeSpace.id);
                                  setSpaces((prev) =>
                                    prev.filter((s) => s.id !== activeSpace.id)
                                  );
                                  setActiveSpace(null);
                                  setConfirmDeleteSpace(false);
                                  api
                                    .listProjects()
                                    .then((pr) => setProjects(pr.projects))
                                    .catch(() => {});
                                  showNotice('success', 'Space deleted.');
                                } catch (err) {
                                  showNotice(
                                    'error',
                                    err instanceof Error
                                      ? err.message
                                      : 'Failed to delete space.'
                                  );
                                }
                              }}
                              className="flex-1 py-1.5 bg-[#dc3545] hover:bg-[#c82333] text-white rounded font-medium"
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteSpace(false)}
                              className="flex-1 py-1.5 bg-white border border-[#d6dce3] text-slate-700 rounded font-medium"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSpace(true)}
                          className="w-full py-2 bg-[#dc3545] hover:bg-[#c82333] text-white rounded-md font-medium flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete space permanently</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Right 3D Architectural Viewer matching Screenshot 2 */}
              <div className="relative flex-1 min-h-[320px] bg-[#cfd7df]">
                <Space3DViewer
                  data={viewData}
                  entities={entities}
                  selectedEntityId={selectedEntityId}
                  onSelectEntity={setSelectedEntityId}
                  onPickFloorPoint={
                    spaceSubTab === 'entities'
                      ? (x, z) => setPickedFloorPoint({ x, z })
                      : undefined
                  }
                  onSnapshotReady={(fn) => {
                    snapshotFnRef.current = fn;
                  }}
                />

                {/* Bottom-right AI Copilot / Help circular dark button matching Screenshot 2 */}
                <button
                  type="button"
                  onClick={() => setAiChatOpen(true)}
                  className="absolute bottom-4 right-4 z-10 w-10 h-10 rounded-full bg-[#1f242c] hover:bg-[#2c333e] text-white shadow-lg flex items-center justify-center"
                  title="Open SpaceKit AI Architect Chat"
                >
                  <HelpCircle className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <AiSpatialChat
          open={aiChatOpen}
          space={activeSpace}
          onClose={() => setAiChatOpen(false)}
          onSpaceUpdated={(updated) => {
            setActiveSpace(updated);
            setDraftData(updated.unpublishedData ?? updated.data);
            setSpaces((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s))
            );
          }}
        />

        <ShareEmbedModal
          open={shareOpen}
          space={activeSpace}
          onClose={() => setShareOpen(false)}
        />
        {noticeBanner}
      </div>
    );
  }

  // ---------------- MAIN WORKSPACE DASHBOARD (Screenshot 1) ----------------
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top Bar matching Screenshot 1 */}
      <header className="h-16 bg-white border-b border-[#e5e8ec] px-5 flex items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-6 min-w-0">
          {/* Brand Logo + Workspace Selector */}
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setTopTab('spaces')}
              className="flex items-center gap-2 font-display font-bold text-xl tracking-tight text-[#1f242c] whitespace-nowrap"
            >
              <span className="w-7 h-7 rounded bg-[#1f242c] text-white flex items-center justify-center text-sm font-bold">
                S
              </span>
              <span>SpaceKit</span>
            </button>

            <div className="relative hidden sm:block pl-3 border-l border-[#e5e8ec]">
              <button
                type="button"
                onClick={() => setWorkspaceMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 px-2 py-1 rounded-md hover:bg-slate-50 transition-colors"
                title="Switch or rename workspace"
              >
                <div className="w-8 h-8 rounded border border-[#e5e8ec] bg-[#f8fafc] flex items-center justify-center text-slate-600">
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="text-left leading-tight">
                  <div className="text-xs font-medium text-[#1f242c] whitespace-nowrap">
                    {user.workspaceName}
                  </div>
                  <div className="text-[11px] text-slate-400 whitespace-nowrap">
                    Your floor plans
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
              </button>

              {workspaceMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setWorkspaceMenuOpen(false)}
                  />
                  <div className="absolute left-3 top-12 z-30 w-64 bg-white border border-[#e5e8ec] rounded-lg shadow-xl p-3 space-y-3 text-xs">
                    <form onSubmit={handleSaveWorkspaceName} className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Workspace name
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          required
                          value={workspaceNameInput}
                          onChange={(e) => setWorkspaceNameInput(e.target.value)}
                          className="flex-1 min-w-0 border border-[#d6dce3] rounded px-2 py-1 text-xs"
                        />
                        <button
                          type="submit"
                          disabled={savingWorkspaceName}
                          className="px-2.5 py-1 bg-[#1f242c] text-white rounded font-medium disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                    <div className="pt-2 border-t border-[#eef1f5] space-y-1">
                      {(
                        [
                          { id: 'spaces', label: 'All spaces' },
                          { id: 'projects', label: 'Projects' },
                          { id: 'developers', label: 'Developers & SDK' },
                          { id: 'usage', label: 'Workspace usage' },
                        ] as const
                      ).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setTopTab(item.id);
                            setWorkspaceMenuOpen(false);
                          }}
                          className={`w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 ${
                            topTab === item.id
                              ? 'font-semibold text-[#1f242c] bg-[#f8fafc]'
                              : 'text-slate-600'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-[#eef1f5]">
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full text-left px-2 py-1.5 rounded text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Primary Nav Tabs */}
          <nav className="flex items-center gap-6 h-16">
            {(
              [
                { id: 'spaces', label: 'Spaces' },
                { id: 'projects', label: 'Projects' },
                { id: 'developers', label: 'Developers' },
                { id: 'usage', label: 'Usage' },
              ] as const
            ).map((tab) => {
              const active = topTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTopTab(tab.id)}
                  className={`h-full px-1 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-[#1f242c] text-[#1f242c]'
                      : 'border-transparent text-slate-500 hover:text-[#1f242c]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Primary Action & User Account */}
        <div className="flex items-center gap-4 shrink-0 relative">
          <button
            type="button"
            onClick={() => {
              setCadModalTargetSpaceId(undefined);
              setCadModalOpen(true);
            }}
            className="px-4 py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New space</span>
          </button>

          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2.5 text-left hover:bg-slate-50 px-2 py-1 rounded-md transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-[#1f242c] text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden md:block leading-tight max-w-[140px]">
              <div className="text-xs font-medium text-[#1f242c] truncate">
                {user.name}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {user.email}
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setUserMenuOpen(false)}
              />
              <div className="absolute right-0 top-12 z-30 w-48 bg-white border border-[#e5e8ec] rounded-md shadow-lg py-1 text-xs">
                <div className="px-3 py-2 border-b border-[#eef1f5]">
                  <div className="font-medium text-[#1f242c] truncate">
                    {user.name}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {user.email}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-left px-3 py-2 text-red-600 hover:bg-slate-50 flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 bg-white">
        {topTab === 'spaces' && (
          <>
            {/* Sub-header row matching Screenshot 1 */}
            <div className="border-b border-[#e5e8ec] px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-6 flex-wrap">
                <h1 className="text-2xl font-normal text-[#1f242c]">
                  All spaces
                </h1>

                <div className="flex items-center gap-6 pl-6 border-l border-[#e5e8ec]">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      Spaces
                    </div>
                    <div className="text-sm font-semibold text-[#1f242c] tabular-nums">
                      {spaces.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      Sqft
                    </div>
                    <div className="text-sm font-semibold text-[#1f242c] tabular-nums">
                      {totalSqft.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      Views
                    </div>
                    <div className="text-sm font-semibold text-[#1f242c] tabular-nums">
                      {totalViews.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Search, Filter, Sort matching Screenshot 1 */}
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-[#d6dce3] rounded-md overflow-hidden bg-white">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search spaces"
                    className="px-3 py-1.5 text-xs w-44 sm:w-56 focus:outline-none"
                  />
                  <div className="px-2.5 py-1.5 border-l border-[#eef1f5] text-slate-400">
                    <Search className="w-3.5 h-3.5" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setFilterMode((m) =>
                      m === 'all' ? 'live' : m === 'live' ? 'geolocated' : 'all'
                    )
                  }
                  className="h-8 px-2.5 border border-[#d6dce3] rounded-md text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 text-xs"
                  title="Cycle filter: All / Live / Geolocated"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {filterMode !== 'all' && (
                    <span className="capitalize">{filterMode}</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSortMode((s) =>
                      s === 'updated' ? 'sqft' : s === 'sqft' ? 'views' : 'updated'
                    )
                  }
                  className="h-8 px-2.5 border border-[#d6dce3] rounded-md text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 text-xs"
                  title="Cycle sort: Recent / Area / Views"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  {sortMode !== 'updated' && (
                    <span className="uppercase">{sortMode}</span>
                  )}
                </button>
              </div>
            </div>

            {/* Space Cards Grid matching Screenshot 1 */}
            <div className="p-6">
              {loadingSpaces ? (
                <div className="py-16 text-center text-xs text-slate-400">
                  Loading spaces from PostgreSQL...
                </div>
              ) : filteredSpaces.length === 0 ? (
                <div className="max-w-lg mx-auto my-14 border border-[#e5e8ec] rounded-lg p-8 text-center space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-[#f1f4f7] text-[#1f242c] flex items-center justify-center mx-auto">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-[#1f242c]">
                      {spaces.length === 0
                        ? 'Upload your first 2D CAD floor plan'
                        : 'No spaces match your search'}
                    </h2>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {spaces.length === 0
                        ? 'Upload a 2D technical drawing image to translate it into an interactive 3D Three.js space via AI, or draw walls directly on the CAD canvas.'
                        : 'Try clearing your search query or switching the active filter.'}
                    </p>
                  </div>
                  {spaces.length === 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCadModalTargetSpaceId(undefined);
                        setCadModalOpen(true);
                      }}
                      className="px-4 py-2 bg-[#1f242c] hover:bg-[#2c333e] text-white rounded-md text-xs font-medium inline-flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New space from 2D CAD</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-7">
                  {filteredSpaces.map((space) => (
                    <div
                      key={space.id}
                      onClick={() => openSpace(space)}
                      className="group cursor-pointer space-y-3"
                    >
                      {/* Thumbnail Box */}
                      <div className="relative aspect-[16/10] rounded-lg overflow-hidden bg-[#cfd7df] border border-[#e5e8ec]/60">
                        <SpaceThumbnail space={space} />
                        {renderStatusBadge(space, 'card')}
                      </div>

                      {/* Open Card Metadata matching Screenshot 1 */}
                      <div className="px-1 space-y-2">
                        <div>
                          <h3 className="text-[17px] font-normal text-[#1f242c] group-hover:underline truncate">
                            {space.name}
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5 truncate">
                            {space.address || 'No location set yet'}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Created {formatRelativeTime(space.createdAt)}
                          </p>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-[#1f242c] tabular-nums">
                          <span className="inline-flex items-center gap-1.5">
                            <Maximize className="w-3.5 h-3.5 text-slate-500" />
                            <span>
                              <strong>{space.sqft.toLocaleString()}</strong> sqft
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-slate-500" />
                            <span>
                              <strong>{space.data.levels.length}</strong> levels
                            </span>
                          </span>
                        </div>

                        <p className="text-xs text-[#3b434f] truncate">
                          {space.description || 'Architectural 3D spatial asset'}
                        </p>

                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Tag className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">
                            {space.tags.length > 0
                              ? space.tags.join(', ')
                              : 'No tags'}
                          </span>
                        </div>

                        <p className="text-xs text-slate-400">
                          Updated {formatRelativeTime(space.updatedAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {topTab === 'projects' && (
          <ProjectsView
            spaces={spaces}
            projects={projects}
            onProjectsChange={setProjects}
            onOpenSpace={openSpace}
          />
        )}
        {topTab === 'developers' && <DevelopersView spaces={spaces} />}
        {topTab === 'usage' && <UsageView />}
      </main>

      <CadUploadModal
        open={cadModalOpen}
        targetSpaceId={cadModalTargetSpaceId}
        onClose={() => setCadModalOpen(false)}
        onSpaceReady={(created) => {
          setSpaces((prev) => [created, ...prev]);
          openSpace(created);
        }}
      />
      {noticeBanner}
    </div>
  );
}
