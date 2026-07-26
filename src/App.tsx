import {
  ArrowRight,
  Check,
  ChevronDown,
  Cloud,
  Command,
  Database,
  Download,
  KeyRound,
  LogOut,
  Moon,
  Search,
  ShieldCheck,
  Sun,
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
import { spaceToJsonCanvas } from "./data/jsonCanvas";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
type ResourceMode = "table" | "query" | "value";

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
  onConnect,
}: {
  connectionState: ConnectionState;
  error: string;
  onConnect: () => void;
}) {
  return (
    <main className="connect-screen">
      <div className="connect-screen__brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>TinyCloud Explorer</span>
      </div>
      <section className="connect-card" aria-labelledby="connect-heading">
        <div className="connect-card__intro">
          <span className="tc-badge">Interactive wireframe</span>
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
            ? "Opening wireframe…"
            : "Connect TinyCloud"}
          <ArrowRight aria-hidden="true" size={17} />
        </button>
        <p className="connect-card__note">
          This review build uses typed fixture data. No wallet request or
          TinyCloud write will occur.
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
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const connect = useCallback(async () => {
    setConnectionState("connecting");
    setConnectionError("");
    try {
      const nextSnapshot = await dataSource.connect();
      setSnapshot(nextSnapshot);
      setSelectedSpaceId(
        nextSnapshot.spaces.find((space) => space.id === "listen")?.id ??
          nextSnapshot.spaces[0]?.id ??
          "",
      );
      setConnectionState("connected");
    } catch (error) {
      setConnectionState("error");
      setConnectionError(
        error instanceof Error
          ? error.message
          : "TinyCloud could not be opened. Try again.",
      );
    }
  }, [dataSource]);

  const disconnect = useCallback(async () => {
    await dataSource.disconnect();
    setSnapshot(null);
    setConnectionState("disconnected");
    setLevel("system");
    setSelectedResourceId(null);
  }, [dataSource]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    setLevel((currentLevel) =>
      currentLevel === "resource" ? "space" : currentLevel,
    );
  }, []);

  const openSpace = useCallback((spaceId: string) => {
    setSelectedSpaceId(spaceId);
    setSelectedResourceId(null);
    setLevel("space");
  }, []);

  const selectResource = useCallback((resourceId: string) => {
    setSelectedResourceId(resourceId);
  }, []);

  const openResource = useCallback(
    (resourceId: string, mode?: ResourceMode) => {
      const resource = selectedSpace?.resources.find(
        (item) => item.id === resourceId,
      );
      setSelectedResourceId(resourceId);
      setResourceMode(mode ?? (resource?.kind === "kv" ? "value" : "table"));
      setLevel("resource");
    },
    [selectedSpace?.resources],
  );

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
      if (event.key === "3" && selectedResource) setLevel("resource");
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
      }[] = [];
      if (space.name.toLowerCase().includes(query)) {
        items.push({
          id: space.id,
          label: space.name,
          detail: `${space.resourceCount} resources`,
          kind: "space",
          spaceId: space.id,
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
            detail: `${space.name} · ${resource.kind.toUpperCase()}`,
            kind: resource.kind,
            spaceId: space.id,
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
      <ConnectScreen
        connectionState={connectionState}
        error={connectionError}
        onConnect={connect}
      />
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

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to explorer
      </a>
      <header className="app-header">
        <div className="app-brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>TinyCloud Explorer</strong>
          <span className="wireframe-chip">Wireframe</span>
        </div>

        <button
          type="button"
          className="identity-button"
          title={snapshot.identity.did}
        >
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>Connected</strong>
            <code>{shorten(snapshot.identity.sessionDid, 14, 4)}</code>
          </span>
          <ChevronDown aria-hidden="true" size={15} />
        </button>

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
            aria-label="Disconnect wireframe session"
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
              Double-click to open · 1/2/3 to change level
            </div>
          </div>

          {level !== "resource" && (
            <>
              <div className="canvas-desktop">
                <CartographCanvas
                  spaces={snapshot.spaces}
                  selectedSpace={selectedSpace}
                  selectedResource={selectedResource}
                  onSelectSpace={selectSpace}
                  onOpenSpace={openSpace}
                  onSelectResource={selectResource}
                  onOpenResource={openResource}
                />
              </div>
              <LedgerView
                spaces={snapshot.spaces}
                selectedSpace={selectedSpace}
                onSelectSpace={selectSpace}
                onOpenResource={(resourceId) => openResource(resourceId)}
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
        />
      </div>

      <EvidenceFooter steps={activeEvidence} />

      <div className="status-bar" aria-live="polite">
        <span>
          <Check aria-hidden="true" size={13} />
          Fixture data ready
        </span>
        <span>
          {snapshot.spaces.length} spaces ·{" "}
          {snapshot.spaces
            .reduce((count, space) => count + space.resourceCount, 0)
            .toLocaleString()}{" "}
          resources
        </span>
        <span>{level.toUpperCase()} level</span>
      </div>
    </div>
  );
}
