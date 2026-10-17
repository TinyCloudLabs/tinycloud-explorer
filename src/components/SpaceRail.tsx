import { Box, Database, KeyRound } from "lucide-react";
import type { TinyCloudSpace } from "../data/ExplorerDataSource";

interface SpaceRailProps {
  spaces: TinyCloudSpace[];
  selectedSpaceId: string;
  onSelectSpace: (spaceId: string) => void;
  onOpenSpace: (spaceId: string) => void;
}

function SpaceIcon({ spaceId }: { spaceId: string }) {
  if (spaceId === "listen") return <Database aria-hidden="true" size={18} />;
  if (spaceId === "credentials")
    return <KeyRound aria-hidden="true" size={18} />;
  return <Box aria-hidden="true" size={18} />;
}

export function SpaceRail({
  spaces,
  selectedSpaceId,
  onSelectSpace,
  onOpenSpace,
}: SpaceRailProps) {
  return (
    <nav className="space-rail" aria-label="TinyCloud spaces">
      <div className="space-rail__heading">
        <h2>Spaces</h2>
        <span className="tc-badge">{spaces.length}</span>
      </div>
      <ul className="space-list">
        {spaces.map((space) => (
          <li key={space.id}>
            <button
              type="button"
              className={space.id === selectedSpaceId ? "is-selected" : ""}
              aria-current={space.id === selectedSpaceId ? "page" : undefined}
              onClick={() => onSelectSpace(space.id)}
              onDoubleClick={() => onOpenSpace(space.id)}
            >
              <span className="space-list__icon">
                <SpaceIcon spaceId={space.id} />
              </span>
              <span>
                <strong>{space.name}</strong>
                <small>
                  {space.discoveryState === "loading"
                    ? "Discovering…"
                    : `${space.resourceCount} resources`}
                </small>
              </span>
              <span className="space-list__access">
                {space.discoveryState === "loading"
                  ? "loading"
                  : space.access === "read-only"
                    ? "read"
                    : "owner"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
