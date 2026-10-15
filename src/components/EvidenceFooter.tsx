import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { CapabilityStep } from "../data/ExplorerDataSource";

interface EvidenceFooterProps {
  steps: CapabilityStep[];
}

export function EvidenceFooter({ steps }: EvidenceFooterProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      className={`evidence${expanded ? " is-expanded" : ""}`}
      aria-label="Authorization evidence"
      data-testid="evidence-footer"
    >
      <div className="evidence__path">
        <ShieldCheck aria-hidden="true" size={18} />
        <span>Session</span>
        <span aria-hidden="true">→</span>
        <span>Delegation</span>
        <span aria-hidden="true">→</span>
        <span>Space</span>
        <span aria-hidden="true">→</span>
        <span>Resource</span>
      </div>
      <ol id="evidence-steps" className="evidence__steps">
        {steps.map((step) => (
          <li key={step.id}>
            <span className="evidence__check">
              <Check aria-hidden="true" size={13} strokeWidth={3} />
            </span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
            {expanded && (
              <time dateTime={step.timestamp}>
                {new Intl.DateTimeFormat(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(new Date(step.timestamp))}
              </time>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="evidence__toggle"
        aria-expanded={expanded}
        aria-controls="evidence-steps"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Hide evidence" : "View evidence"}
        <ChevronDown aria-hidden="true" size={16} />
      </button>
    </section>
  );
}
