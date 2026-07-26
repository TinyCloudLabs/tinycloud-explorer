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
}

export function LedgerView({
  spaces,
  selectedSpace,
  onSelectSpace,
  onOpenResource,
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
          return (
            <li key={resource.id}>
              <button type="button" onClick={() => onOpenResource(resource.id)}>
                <Icon aria-hidden="true" size={20} />
                <span>
                  <strong>{resource.name}</strong>
                  <small>
                    {resource.kind.toUpperCase()} · {resource.access}
                  </small>
                </span>
                <ChevronRight aria-hidden="true" size={18} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
