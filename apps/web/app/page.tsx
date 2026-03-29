import { DEFAULT_REGION } from "@signalstack/contracts";
import { Badge, Panel, SectionTitle } from "@signalstack/ui";
import { fetchDashboardData } from "../lib/api";
import { MapViewport } from "../components/map-viewport";
import { RenoAtcPanel } from "../components/reno-atc-panel";
import { RenoScannerPanel } from "../components/reno-scanner-panel";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await fetchDashboardData().catch(() => ({
    layers: [],
    events: [],
    stacks: [],
    cameras: [],
    replay: {
      range: "15m" as const,
      generatedAt: new Date().toISOString(),
      frames: []
    },
    flightSubscriptions: []
  }));

  return (
    <main className="shell">
      <section className="workspace-summary">
        <div>
          <div className="workspace-kicker">Smash Atoms</div>
          <h1 className="workspace-title">The Overwatch</h1>
          <p className="workspace-subtitle">Regional live-view dashboard for Reno operations, cameras, and signals</p>
        </div>
        <div className="tag-row">
          <Badge tone="accent">{DEFAULT_REGION.name}</Badge>
          <Badge tone="neutral">Leaflet base</Badge>
          <Badge tone="neutral">Camera-first layout</Badge>
        </div>
      </section>

      <section className="hero-grid hero-grid-single">
        <Panel className="map-panel">
          <div className="panel-header">
            <SectionTitle
              title="Operations map"
              subtitle="Live map, airport cameras, and overlay controls in one workspace"
            />
            <div className="tag-row">
              <Badge tone="accent">Live Cameras</Badge>
              <Badge tone="neutral">Doppler Ready</Badge>
              <Badge tone="neutral">Overlay Filters</Badge>
            </div>
          </div>
          <MapViewport
            region={DEFAULT_REGION}
            events={data.events}
            stacks={data.stacks}
            cameras={data.cameras}
            initialFlightSubscriptions={data.flightSubscriptions}
          />
        </Panel>
      </section>

      <section className="operations-grid">
        <Panel>
          <RenoAtcPanel events={data.events} />
        </Panel>

        <Panel>
          <RenoScannerPanel events={data.events} />
        </Panel>
      </section>
    </main>
  );
}
