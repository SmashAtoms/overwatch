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
import { RenoAtcPanel } from "../components/reno-atc-panel";
import { RenoScannerPanel } from "../components/reno-scanner-panel";
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
          <div className="panel-header">
            <SectionTitle
              title="Information stacks"
              subtitle="Grouped signals, incidents, and airport activity"
            />
            <Badge tone="accent">{data.stacks.length} active</Badge>
          </div>
          <div className="stack-list">
            {data.stacks.map((stack) => (
              <StackCard key={stack.id} stack={stack} />
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="panel-header">
            <SectionTitle
              title="Reno Airport ATC"
              subtitle="Pacific-time transcript view for Reno tower and approach traffic"
            />
            <Badge tone="accent">
              {data.events.filter((event) => event.sourceType === "atc" && event.transcript).length} updates
            </Badge>
          </div>
          <RenoAtcPanel events={data.events} />
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

      <section className="timeline-grid">
        <Panel>
          <div className="panel-header">
            <SectionTitle
              title="Future signal modules"
              subtitle="Scanner, incident correlation, and operator queue workspace planning"
            />
            <Badge tone="neutral">Planned next</Badge>
          </div>
          <div className="future-module-grid">
            <article className="future-module-card">
              <strong>Scanner workspace</strong>
              <p>Conversation threads, incident grouping, and map-linked unit activity.</p>
            </article>
            <article className="future-module-card">
              <strong>Camera correlation</strong>
              <p>Nearest camera suggestions, runway views, and event-linked live feed focus.</p>
            </article>
            <article className="future-module-card">
              <strong>Operator queue</strong>
              <p>Bookmarks, pinned incidents, and replay handoff notes for the next pass.</p>
            </article>
            <article className="future-module-card">
              <strong>Authorized ingest hook</strong>
              <p>Drop-in place for a licensed or operator-owned Reno ATC audio source.</p>
            </article>
          </div>
        </Panel>
      </section>

      <section className="timeline-grid">
        <Panel>
          <div className="panel-header">
            <SectionTitle
              title="Reno Police Radio"
              subtitle="Scanner transcript, speaker buckets, and code-word interpretation"
            />
            <Badge tone="accent">
              {data.events.filter((event) => event.sourceType === "scanner" && event.transcript).length} updates
            </Badge>
          </div>
          <RenoScannerPanel events={data.events} />
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
