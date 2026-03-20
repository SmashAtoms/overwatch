import type { AdapterHealth } from "@signalstack/contracts";
import { Panel, StatusRow } from "@signalstack/ui";
import { formatLagLabel } from "@signalstack/policy";

type SourceHealthStripProps = {
  items: AdapterHealth[];
};

export function SourceHealthStrip({ items }: SourceHealthStripProps) {
  return (
    <div className="content-grid">
      {items.map((item) => (
        <Panel key={item.adapterId}>
          <StatusRow
            label={item.kind}
            status={item.status}
            value={`${formatLagLabel(item.lagMs)} | ${item.policyMode}`}
            detail={item.lastSuccessAt ?? "No successful update yet"}
          />
        </Panel>
      ))}
    </div>
  );
}
