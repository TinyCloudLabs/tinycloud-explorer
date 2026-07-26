import { ChevronRight, Database, KeyRound } from "lucide-react";
import type {
  TinyCloudResource,
  TinyCloudSpace,
} from "../data/ExplorerDataSource";

interface LedgerViewProps {
  spaces: TinyCloudSpace[];
  selectedSpace: TinyCloudSpace;
  onSelectSpace: (spaceId: string) => void;
  onOpenResource: (resourceId: string) => void;
  onGrantPermission: (resourceId: string) => void;
}

export function LedgerView({
  spaces,
  selectedSpace,
  onSelectSpace,
  onOpenResource,
  onGrantPermission,
}: LedgerViewProps) {
  return (
    <div className="ledger" data-testid="mobile-ledger">
      <label className="ledger__space-picker">
        <span>Space</span>
        <select
          value={selectedSpace.id}
          onChange={(event) => onSelectSpace(event.target.value)}
        >
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name} · {space.resourceCount} resources
            </option>
          ))}
        </select>
      </label>

      <div className="ledger__summary">
        <span className="tc-status tc-status--success">verified</span>
        <code>{selectedSpace.uri}</code>
      </div>

      <ul className="ledger__resources">
        {selectedSpace.resources.map((resource: TinyCloudResource) => {
          const Icon = resource.kind === "sql" ? Database : KeyRound;
          const needsPermission = resource.access === "needs-permission";
          const accessLabel =
            resource.access === "read-write"
              ? "read + write"
              : needsPermission
                ? "needs permission"
                : "read only";
          return (
            <li key={resource.id}>
              <button
                type="button"
                aria-label={`${resource.name} ${resource.kind.toUpperCase()} ${accessLabel}${needsPermission ? ", grant permission" : ""}`}
                onClick={() =>
                  needsPermission
                    ? onGrantPermission(resource.id)
                    : onOpenResource(resource.id)
                }
              >
                <Icon aria-hidden="true" size={20} />
                <span>
                  <strong>{resource.name}</strong>
                  <small>
                    {resource.kind.toUpperCase()} · {accessLabel}
                  </small>
                </span>
                {needsPermission ? (
                  <small>Grant permission</small>
                ) : (
                  <ChevronRight aria-hidden="true" size={18} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
