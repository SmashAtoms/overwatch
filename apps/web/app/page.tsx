import { DEFAULT_REGION, type SignalEvent } from "@signalstack/contracts";
import {
  Badge,
  Panel,
  SectionTitle,
  StackCard,
  StatusRow,
  TimelineBar
} from "@signalstack/ui";
import { buildReplayMarks, formatLagLabel, summarizeLayerStatus } from "@signalstack/policy";
import { fetchDashboardData } from "../lib/api";
import { MapViewport } from "../components/map-viewport";
import { SourceHealthStrip } from "../components/source-health-strip";
import { TranscriptFeed } from "../components/transcript-feed";
import { DetailPanel } from "../components/detail-panel";

export const dynamic = "force-dynamic";

function selectPrimaryEvent(events: SignalEvent[]): SignalEvent | undefined {
  return events.find((event) => event.sourceType === "aircraft") ?? events[0];
}

export default async function HomePage() {
  const data = await fetchDashboardData();
  const selectedEvent = selectPrimaryEvent(data.events);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Production-minded operator dashboard</p>
          <h1>Reno SignalStack</h1>
        </div>
        <div className="topbar-meta">
          <Badge tone="accent">{DEFAULT_REGION.name}</Badge>
          <Badge tone="neutral">Replay Ready</Badge>
          <Badge tone="neutral">Mock Adapters Active</Badge>
        </div>
      </header>

      <SourceHealthStrip items={data.layers} />

      <section className="hero-grid">
        <Panel className="map-panel">
          <div className="panel-header">
            <SectionTitle
              title="2D Map Base"
              subtitle="2D base map with API overlays and live doppler weather"
            />
            <div className="tag-row">
              <Badge tone="accent">Working MVP</Badge>
              <Badge tone="neutral">Leaflet + Google</Badge>
              <Badge tone="neutral">Live Doppler</Badge>
            </div>
          </div>
          <MapViewport
            region={DEFAULT_REGION}
            events={data.events}
            stacks={data.stacks}
            cameras={data.cameras}
          />
        </Panel>

        <Panel className="stack-panel">
          <div className="panel-header">
            <SectionTitle
              title="Information Stacks"
              subtitle="Related signals grouped by place, time, and source"
            />
            <Badge tone="accent">{data.stacks.length} active</Badge>
          </div>
          <div className="stack-list">
            {data.stacks.map((stack) => (
              <StackCard key={stack.id} stack={stack} />
            ))}
          </div>
        </Panel>
      </section>

      <section className="timeline-grid">
        <Panel>
          <div className="panel-header">
            <SectionTitle
              title="Replay Timeline"
              subtitle="15 min, 1 hr, 6 hr, and 24 hr windows with synchronized layers"
            />
            <Badge tone="neutral">{data.replay.frames.length} frames</Badge>
          </div>
          <TimelineBar marks={buildReplayMarks(data.replay)} />
        </Panel>
      </section>

      <section className="content-grid">
        <Panel>
          <div className="panel-header">
            <SectionTitle
              title="Transcript Feed"
              subtitle="Raw evidence stays visible beside cleaned interpretation"
            />
            <Badge tone="neutral">
              {data.events.filter((event) => event.sourceType !== "weather").length} signal events
            </Badge>
          </div>
          <TranscriptFeed events={data.events} />
        </Panel>

        <Panel>
          <div className="panel-header">
            <SectionTitle
              title="Details"
              subtitle="Selected aircraft, camera, or incident context"
            />
            {selectedEvent ? <Badge tone="accent">{selectedEvent.sourceType}</Badge> : null}
          </div>
          <DetailPanel event={selectedEvent} />
        </Panel>

        <Panel>
          <div className="panel-header">
            <SectionTitle
              title="Layer Status"
              subtitle="Graceful degradation and policy awareness"
            />
            <Badge tone="neutral">{summarizeLayerStatus(data.layers)}</Badge>
          </div>
          <div className="status-list">
            {data.layers.map((layer) => (
              <StatusRow
                key={layer.adapterId}
                label={layer.kind}
                status={layer.status}
                value={`${formatLagLabel(layer.lagMs)} | ${layer.policyMode}`}
                detail={layer.lastSuccessAt ?? "No successful poll yet"}
              />
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}
