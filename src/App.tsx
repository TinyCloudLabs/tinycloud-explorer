import {
  ArrowRight,
  Check,
  Cloud,
  Command,
  Database,
  Download,
  KeyRound,
  LogOut,
  Moon,
  Search,
  ShieldCheck,
  ScrollText,
  Sun,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CartographCanvas } from "./components/CartographCanvas";
import { DebugLogPanel } from "./components/DebugLogPanel";
import { EvidenceFooter } from "./components/EvidenceFooter";
import { Inspector } from "./components/Inspector";
import { KvWorkspace } from "./components/KvWorkspace";
import { LedgerView } from "./components/LedgerView";
import { SpaceRail } from "./components/SpaceRail";
import { SqlWorkspace } from "./components/SqlWorkspace";
import type {
  ExplorerDataSource,
  ExplorerLevel,
  ExplorerSnapshot,
  TinyCloudResource,
} from "./data/ExplorerDataSource";
import {
  classifyExplorerFailure,
} from "./data/explorerErrors";
import { spaceToJsonCanvas } from "./data/jsonCanvas";
import {
  clearExplorerLogs,
  getExplorerLogs,
  subscribeExplorerLogs,
  type ExplorerLogEntry,
} from "./data/debugLog";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
type ResourceMode = "table" | "query" | "value";
type GrantState = "idle" | "granting" | "granted" | "error";

interface AppProps {
  dataSource: ExplorerDataSource;
}

function shorten(value: string, start = 16, end = 5) {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function ConnectScreen({
  connectionState,
  error,
  mode,
  onConnect,
  logCount,
  onOpenLogs,
}: {
  connectionState: ConnectionState;
  error: string;
  mode: ExplorerDataSource["mode"];
  onConnect: () => void;
  logCount: number;
  onOpenLogs: () => void;
}) {
  return (
    <main className="connect-screen">
      <div className="connect-screen__brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>TinyCloud Explorer</span>
      </div>
      <section className="connect-card" aria-labelledby="connect-heading">
        <div className="connect-card__intro">
          <h1 id="connect-heading">See the shape of your TinyCloud.</h1>
          <p>
            Explore spaces, open SQL tables, inspect key-value data, and keep
            the capability trail visible at every step.
          </p>
        </div>
        <ol className="connect-flow" aria-label="Explorer flow">
          <li>
            <Cloud aria-hidden="true" size={20} />
            <span>
              <strong>Map spaces</strong>
              <small>Start with the whole account.</small>
            </span>
          </li>
          <li>
            <Database aria-hidden="true" size={20} />
            <span>
              <strong>Open data</strong>
              <small>Browse SQL and key-value resources.</small>
            </span>
          </li>
          <li>
            <ShieldCheck aria-hidden="true" size={20} />
            <span>
              <strong>Verify access</strong>
              <small>Trace session, delegation, space, and resource.</small>
            </span>
          </li>
        </ol>
        {error && (
          <p className="inline-error" role="alert">
            <TriangleAlert aria-hidden="true" size={18} />
            {error}
          </p>
        )}
        <button
          type="button"
          className="tc-button tc-button--primary connect-button"
          onClick={onConnect}
          disabled={connectionState === "connecting"}
          data-testid="connect-tinycloud"
        >
          {connectionState === "connecting"
            ? mode === "mock"
              ? "Opening wireframe…"
              : "Connecting identity and TinyCloud access…"
            : "Connect TinyCloud"}
          <ArrowRight aria-hidden="true" size={17} />
        </button>
        <button
          type="button"
          className="tc-button connect-log-button"
          onClick={onOpenLogs}
        >
          <ScrollText aria-hidden="true" size={16} />
          View debug log{logCount > 0 ? ` (${logCount})` : ""}
        </button>
        <p className="connect-card__note">
          {mode === "mock"
            ? "This explicit development mode uses seeded mock data. No wallet request or network write will occur."
            : "OpenKey selects your wallet. One TinyCloud SIWE both authenticates you and grants the capabilities Explorer may use."}
        </p>
      </section>
    </main>
  );
}

function SemanticTabs({
  level,
  resourceAvailable,
  onChange,
}: {
  level: ExplorerLevel;
  resourceAvailable: boolean;
  onChange: (level: ExplorerLevel) => void;
}) {
  return (
    <div className="semantic-tabs" role="tablist" aria-label="Explorer level">
      {(["system", "space", "resource"] as const).map((item, index) => (
        <button
          type="button"
          role="tab"
          key={item}
          aria-selected={level === item}
          disabled={item === "resource" && !resourceAvailable}
          onClick={() => onChange(item)}
        >
          <span className="semantic-tabs__full">{item}</span>
          <span className="semantic-tabs__compact">
            {item === "system" ? "Map" : item === "resource" ? "Data" : "Space"}
          </span>
          <kbd>{index + 1}</kbd>
        </button>
      ))}
    </div>
  );
}

function DiscoverySkeleton({
  spaceName,
  error,
  onOpenLogs,
}: {
  spaceName: string;
  error: string;
  onOpenLogs: () => void;
}) {
  return (
    <section
      className={`discovery-skeleton${error ? " discovery-skeleton--error" : ""}`}
      aria-live="polite"
      aria-busy={!error}
      data-testid="discovery-skeleton"
    >
      <div className="discovery-skeleton__copy">
        <strong>{error ? "Discovery paused" : `Discovering ${spaceName}`}</strong>
        <span>
          {error
            ? error
            : "SQL catalogs and key-value groups will appear as TinyCloud returns them."}
        </span>
      </div>
      {error ? (
        <button type="button" className="tc-button" onClick={onOpenLogs}>
          <ScrollText aria-hidden="true" size={15} />
          View debug log
        </button>
      ) : (
        <div className="discovery-skeleton__rows" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </section>
  );
}

export function App({ dataSource }: AppProps) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [connectionError, setConnectionError] = useState("");
  const [snapshot, setSnapshot] = useState<ExplorerSnapshot | null>(null);
  const [level, setLevel] = useState<ExplorerLevel>("system");
  const [selectedSpaceId, setSelectedSpaceId] = useState("listen");
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );
  const [resourceMode, setResourceMode] = useState<ResourceMode>("table");
  const [grantState, setGrantState] = useState<GrantState>("idle");
  const [grantError, setGrantError] = useState("");
  const [connectionIssue, setConnectionIssue] = useState<string>("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [searchQuery, setSearchQuery] = useState("");
  const [spaceGrantState, setSpaceGrantState] =
    useState<"idle" | "granting" | "error">("idle");
  const [spaceGrantError, setSpaceGrantError] = useState("");
  const [logs, setLogs] = useState<ExplorerLogEntry[]>(getExplorerLogs);
  const [logsOpen, setLogsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const connect = useCallback(async () => {
    clearExplorerLogs();
    setConnectionState("connecting");
    setConnectionError("");
    setConnectionIssue("");
    let receivedSnapshot = false;
    const receiveSnapshot = (nextSnapshot: ExplorerSnapshot) => {
      receivedSnapshot = true;
      setSnapshot(nextSnapshot);
      setSelectedSpaceId((current) =>
        nextSnapshot.spaces.some((space) => space.id === current)
          ? current
          : nextSnapshot.spaces[0]?.id ?? "",
      );
      setConnectionState("connected");
    };
    try {
      receiveSnapshot(await dataSource.connect(receiveSnapshot));
    } catch (error) {
      setConnectionState("error");
      const kind = classifyExplorerFailure(error);
      setConnectionIssue(kind);
      setConnectionError(
        error instanceof Error
          ? error.message
          : "TinyCloud could not be opened. Try again.",
      );
      if (!receivedSnapshot) setSnapshot(null);
    }
  }, [dataSource]);

  const disconnect = useCallback(async () => {
    await dataSource.disconnect();
    setSnapshot(null);
    setConnectionState("disconnected");
    setLevel("system");
    setSelectedResourceId(null);
    setGrantState("idle");
    setGrantError("");
    setConnectionIssue("");
    setSpaceGrantState("idle");
    setSpaceGrantError("");
  }, [dataSource]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => subscribeExplorerLogs(setLogs), []);

  const selectedSpace = useMemo(
    () =>
      snapshot?.spaces.find((space) => space.id === selectedSpaceId) ??
      snapshot?.spaces[0] ??
      null,
    [selectedSpaceId, snapshot],
  );
  const selectedResource = useMemo(
    () =>
      selectedSpace?.resources.find(
        (resource) => resource.id === selectedResourceId,
      ) ?? null,
    [selectedResourceId, selectedSpace],
  );

  const selectSpace = useCallback((spaceId: string) => {
    setSelectedSpaceId(spaceId);
    setSelectedResourceId(null);
    setGrantState("idle");
    setGrantError("");
    setSpaceGrantState("idle");
    setSpaceGrantError("");
    setLevel((currentLevel) =>
      currentLevel === "resource" ? "space" : currentLevel,
    );
  }, []);

  const openSpace = useCallback((spaceId: string) => {
    setSelectedSpaceId(spaceId);
    setSelectedResourceId(null);
    setGrantState("idle");
    setGrantError("");
    setSpaceGrantState("idle");
    setSpaceGrantError("");
    setLevel("space");
  }, []);

  const selectResource = useCallback((resourceId: string) => {
    setSelectedResourceId(resourceId);
    setGrantState("idle");
    setGrantError("");
  }, []);

  const openResource = useCallback(
    (resourceId: string, mode?: ResourceMode) => {
      const resource = selectedSpace?.resources.find(
        (item) => item.id === resourceId,
      );
      setSelectedResourceId(resourceId);
      setGrantState("idle");
      setGrantError("");
      setResourceMode(mode ?? (resource?.kind === "kv" ? "value" : "table"));
      setLevel("resource");
    },
    [selectedSpace?.resources],
  );

  const updateResource = useCallback(
    (resource: TinyCloudResource) => {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              spaces: current.spaces.map((space) =>
                  space.id === selectedSpace?.id
                    ? {
                        ...space,
                        resources:
                          resource.kind === "kv" && resource.entries.length === 0
                            ? space.resources.filter((item) => item.id !== resource.id)
                            : space.resources.some((item) => item.id === resource.id)
                              ? space.resources.map((item) =>
                                  item.id === resource.id ? resource : item,
                                )
                              : [...space.resources, resource],
                      }
                    : space,
                ),
              }
            : current,
      );
      if (resource.kind === "kv" && resource.entries.length === 0 && selectedResourceId === resource.id) {
        setSelectedResourceId(null);
        setLevel("space");
      }
    },
    [selectedResourceId, selectedSpace?.id],
  );

  const grantPermission = useCallback(
    async (resourceId: string) => {
      if (!selectedSpace) return;
      setGrantState("granting");
      setGrantError("");
      try {
        const granted = await dataSource.grantPermission(
          selectedSpace.id,
          resourceId,
        );
        setSnapshot((current) =>
          current
            ? {
                ...current,
                spaces: current.spaces.map((space) =>
                  space.id === selectedSpace.id
                    ? {
                        ...space,
                        resources: space.resources.map((resource) =>
                          resource.id === granted.id ? granted : resource,
                        ),
                      }
                    : space,
                ),
              }
            : current,
        );
        setGrantState("granted");
      } catch (error) {
        setGrantState("error");
        const kind = classifyExplorerFailure(error);
        setGrantError(
          kind === "denied-capability"
            ? "OpenKey denied the access request."
            : error instanceof Error
              ? error.message
              : "The permission request could not be completed.",
        );
      }
    },
    [dataSource, selectedSpace],
  );

  const grantSpacePermissions = useCallback(async () => {
    if (!selectedSpace) return;
    setSpaceGrantState("granting");
    setSpaceGrantError("");
    try {
      const granted = await dataSource.grantSpacePermissions(selectedSpace.id);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              spaces: current.spaces.map((space) =>
                space.id === granted.id ? granted : space,
              ),
            }
          : current,
      );
      setSpaceGrantState("idle");
    } catch (error) {
      setSpaceGrantState("error");
      const kind = classifyExplorerFailure(error);
      setSpaceGrantError(
        kind === "denied-capability"
          ? "OpenKey denied the discovery request."
          : error instanceof Error
            ? error.message
            : "The discovery request could not be completed.",
      );
    }
  }, [dataSource, selectedSpace]);

  const changeLevel = useCallback(
    (nextLevel: ExplorerLevel) => {
      if (nextLevel === "resource" && !selectedResource) return;
      setLevel(nextLevel);
    },
    [selectedResource],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (isTyping) return;
      if (event.key === "1") setLevel("system");
      if (event.key === "2") setLevel("space");
      if (event.key === "3" && selectedResource) {
        setLevel("resource");
      }
      if (event.key === "Escape") {
        if (level === "resource") setLevel("space");
        else if (level === "space") setLevel("system");
        else setSelectedResourceId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [level, selectedResource]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!snapshot || query.length < 2) return [];
    return snapshot.spaces.flatMap((space) => {
      const items: {
        id: string;
        label: string;
        detail: string;
        kind: "space" | "sql" | "kv";
        spaceId: string;
        readable: boolean;
      }[] = [];
      if (space.name.toLowerCase().includes(query)) {
        items.push({
          id: space.id,
          label: space.name,
          detail: `${space.resourceCount} resources`,
          kind: "space",
          spaceId: space.id,
          readable: true,
        });
      }
      space.resources.forEach((resource) => {
        if (
          resource.name.toLowerCase().includes(query) ||
          resource.path.toLowerCase().includes(query)
        ) {
          items.push({
            id: resource.id,
            label: resource.name,
            detail: `${space.name} · ${resource.kind.toUpperCase()} · ${
              resource.access === "read-write"
                ? "read + write"
                : resource.access === "needs-permission"
                  ? "Needs additional permission"
                  : "read only"
            }`,
            kind: resource.kind,
            spaceId: space.id,
            readable: resource.permissions.read,
          });
        }
      });
      return items;
    });
  }, [searchQuery, snapshot]);

  const selectSearchResult = (result: (typeof searchResults)[number]) => {
    setSelectedSpaceId(result.spaceId);
    if (result.kind === "space") {
      setSelectedResourceId(null);
      setLevel("space");
    } else {
      setSelectedResourceId(result.id);
      setLevel("resource");
      setResourceMode(result.kind === "sql" ? "table" : "value");
    }
    setSearchQuery("");
  };

  const exportCanvas = () => {
    if (!snapshot || !selectedSpace) return;
    const canvasDocument = spaceToJsonCanvas(snapshot.spaces, selectedSpace);
    const blob = new Blob([JSON.stringify(canvasDocument, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedSpace.name}.canvas`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!snapshot) {
    return (
      <>
        <ConnectScreen
          connectionState={connectionState}
          error={
            connectionIssue === "cancelled-auth"
              ? "OpenKey sign-in was cancelled."
              : connectionIssue === "expired-session"
                ? "The OpenKey or TinyCloud session expired."
              : connectionIssue === "denied-capability"
                ? "OpenKey denied the requested capability."
              : connectionIssue === "network-error"
                ? "A network error blocked TinyCloud discovery."
                : connectionIssue === "empty-space"
                  ? "The connected session can see no TinyCloud spaces."
                  : connectionIssue === "unsupported-resource"
                    ? "The connected session exposed an unsupported resource."
                    : connectionError
          }
          mode={dataSource.mode}
          onConnect={connect}
          logCount={logs.length}
          onOpenLogs={() => setLogsOpen(true)}
        />
        {logsOpen && (
          <DebugLogPanel
            entryTheme
            entries={logs}
            onClear={clearExplorerLogs}
            onClose={() => setLogsOpen(false)}
          />
        )}
      </>
    );
  }

  if (!selectedSpace) {
    return (
      <main className="fatal-state">
        <h1>No accessible spaces</h1>
        <p>
          The active session is valid, but it does not expose a TinyCloud space.
        </p>
        <button type="button" className="tc-button" onClick={disconnect}>
          Sign out
        </button>
      </main>
    );
  }

  const activeEvidence =
    selectedResource?.evidence ??
    (level === "system" ? snapshot.evidence : selectedSpace.evidence);
  const discoveryActive =
    snapshot.discovery !== undefined && snapshot.discovery.phase !== "ready";
  const selectedSpaceLoading = selectedSpace.discoveryState === "loading";

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to explorer
      </a>
      <header className="app-header">
        <div className="app-brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>TinyCloud Explorer</strong>
        </div>

        <div className="identity-status" title={snapshot.identity.did}>
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>Connected</strong>
            <code>{shorten(snapshot.identity.sessionDid, 14, 4)}</code>
            <span className="sr-only">Identity {snapshot.identity.did}</span>
          </span>
        </div>

        <div className="global-search">
          <Search aria-hidden="true" size={17} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search spaces, resources, owners…"
            aria-label="Search TinyCloud"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <kbd>/</kbd>
          {searchResults.length > 0 && (
            <div className="search-results" role="listbox">
              {searchResults.map((result) => {
                const Icon =
                  result.kind === "space"
                    ? Cloud
                    : result.kind === "sql"
                      ? Database
                      : KeyRound;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    key={`${result.kind}-${result.id}`}
                    onClick={() => selectSearchResult(result)}
                  >
                    <Icon aria-hidden="true" size={17} />
                    <span>
                      <strong>{result.label}</strong>
                      <small>{result.detail}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <SemanticTabs
          level={level}
          resourceAvailable={Boolean(selectedResource)}
          onChange={changeLevel}
        />

        <div className="header-actions">
          <button
            type="button"
            className="icon-button log-button"
            aria-label={`Open debug log with ${logs.length} events`}
            aria-pressed={logsOpen}
            onClick={() => setLogsOpen((open) => !open)}
          >
            <ScrollText aria-hidden="true" size={18} />
            {logs.length > 0 && <span>{Math.min(logs.length, 99)}</span>}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}
            onClick={() =>
              setTheme((current) => (current === "light" ? "dark" : "light"))
            }
          >
            {theme === "light" ? (
              <Moon aria-hidden="true" size={18} />
            ) : (
              <Sun aria-hidden="true" size={18} />
            )}
          </button>
          <button type="button" className="tc-button" onClick={exportCanvas}>
            <Download aria-hidden="true" size={16} />
            Export canvas
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Disconnect session"
            onClick={disconnect}
          >
            <LogOut aria-hidden="true" size={18} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <SpaceRail
          spaces={snapshot.spaces}
          selectedSpaceId={selectedSpace.id}
          onSelectSpace={selectSpace}
          onOpenSpace={openSpace}
        />

        <main id="main-content" className="workspace__main">
          <div className="workspace__context">
            <div>
              <span>{level === "system" ? "Your TinyCloud" : selectedSpace.name}</span>
              <code>{level === "system" ? snapshot.identity.nodeUrl : selectedSpace.uri}</code>
            </div>
            <div className="context-hint">
              <Command aria-hidden="true" size={15} />
              {selectedSpaceLoading
                ? "Resources appear as they are discovered"
                : "Double-click to open · 1/2/3 to change level"}
            </div>
          </div>

          {level !== "resource" && (
            <>
              {!selectedSpaceLoading && selectedSpace.resources.length === 0 && (
                <section className="query-empty" aria-live="polite">
                  <Cloud aria-hidden="true" size={30} />
                  {selectedSpace.access === "needs-permission" ? (
                    <>
                      <h2>Resources need additional permission</h2>
                      <p>
                        TinyCloud can see this space, but this session cannot
                        discover its SQL databases or key-value records yet.
                      </p>
                      <p className="query-empty__scope">
                        Read and discovery only. Write access is not requested.
                      </p>
                      <button
                        type="button"
                        className="tc-button tc-button--primary"
                        onClick={grantSpacePermissions}
                        disabled={spaceGrantState === "granting"}
                      >
                        {spaceGrantState === "granting"
                          ? "Granting discovery access…"
                          : "Grant discovery access"}
                      </button>
                      {spaceGrantError && (
                        <p className="inline-error" role="alert">
                          {spaceGrantError}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <h2>No resources found</h2>
                      <p>
                        This session can explore the space, but it currently
                        contains no discoverable SQL databases or key-value records.
                      </p>
                    </>
                  )}
                </section>
              )}
              <div
                className="canvas-desktop"
                aria-busy={selectedSpaceLoading}
              >
                <CartographCanvas
                  discoveryPhase={snapshot.discovery?.phase ?? "ready"}
                  spaces={snapshot.spaces}
                  selectedSpace={selectedSpace}
                  selectedResource={selectedResource}
                  onSelectSpace={selectSpace}
                  onOpenSpace={openSpace}
                  onSelectResource={selectResource}
                  onOpenResource={openResource}
                  onGrantPermission={grantPermission}
                />
                {selectedSpaceLoading && (
                  <DiscoverySkeleton
                    spaceName={selectedSpace.name}
                    error={connectionState === "error" ? connectionError : ""}
                    onOpenLogs={() => setLogsOpen(true)}
                  />
                )}
              </div>
              <LedgerView
                spaces={snapshot.spaces}
                selectedSpace={selectedSpace}
                onSelectSpace={selectSpace}
                onOpenResource={(resourceId) => openResource(resourceId)}
                onGrantPermission={grantPermission}
              />
            </>
          )}

          {level === "resource" &&
            selectedResource?.kind === "sql" && (
              <SqlWorkspace
                key={`${selectedResource.id}-${resourceMode}`}
                space={selectedSpace}
                resource={selectedResource}
                initialMode={resourceMode === "query" ? "query" : "table"}
                dataSource={dataSource}
                onBack={() => setLevel("space")}
              />
            )}
          {level === "resource" && selectedResource?.kind === "kv" && (
            <KvWorkspace
              space={selectedSpace}
              resource={selectedResource}
              onBack={() => setLevel("space")}
              onWriteEntry={async (key, value) => {
                const updated = await dataSource.writeKvEntry(
                  selectedSpace.id,
                  selectedResource.id,
                  key,
                  value,
                );
                updateResource(updated);
              }}
              onDeleteEntry={async (key) => {
                const updated = await dataSource.deleteKvEntry(
                  selectedSpace.id,
                  selectedResource.id,
                  key,
                );
                updateResource(updated);
              }}
            />
          )}
        </main>

        <Inspector
          space={selectedSpace}
          resource={selectedResource}
          onCloseResource={() => {
            setSelectedResourceId(null);
            if (level === "resource") setLevel("space");
          }}
          onOpenResource={openResource}
          onGrantPermission={grantPermission}
          grantState={grantState}
          grantError={grantError}
        />
      </div>

      <EvidenceFooter steps={activeEvidence} />

      <div className="status-bar" aria-live="polite">
        <span>
          <Check aria-hidden="true" size={13} />
          {grantState === "granted"
            ? dataSource.mode === "mock"
              ? "Permission granted in SDK mock"
              : "Access request approved"
            : dataSource.mode === "mock"
              ? "SDK mock data ready"
              : discoveryActive
                ? "TinyCloud session ready · discovering resources"
                : "Real TinyCloud session ready"}
        </span>
        <span>
          {discoveryActive && snapshot.discovery
            ? `${snapshot.discovery.completedSpaces}/${snapshot.discovery.totalSpaces} spaces ready · `
            : `${snapshot.spaces.length} spaces · `}
          {snapshot.spaces
            .reduce((count, space) => count + space.resourceCount, 0)
            .toLocaleString()}{" "}
          resources
        </span>
        <span>{level.toUpperCase()} level</span>
      </div>

      {logsOpen && (
        <DebugLogPanel
          entries={logs}
          onClear={clearExplorerLogs}
          onClose={() => setLogsOpen(false)}
        />
      )}
    </div>
  );
}
