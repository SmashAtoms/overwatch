import type { ReactNode } from "react";
import type { InformationStack, SourceStatus } from "@signalstack/contracts";

const toneClasses = {
  accent: {
    color: "#05131f",
    background: "#7de2d1"
  },
  neutral: {
    color: "#d8e6fb",
    background: "rgba(146, 167, 198, 0.16)"
  }
} as const;

export function Panel({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={className}
      style={{
        padding: "1rem",
        borderRadius: "1.4rem",
        border: "1px solid rgba(120, 162, 212, 0.24)",
        background: "rgba(6, 20, 38, 0.78)",
        boxShadow: "0 20px 40px rgba(0, 0, 0, 0.28)",
        backdropFilter: "blur(16px)"
      }}
    >
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone
}: {
  children: ReactNode;
  tone: "accent" | "neutral";
}) {
  const style = toneClasses[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.35rem 0.65rem",
        borderRadius: "999px",
        fontSize: "0.78rem",
        lineHeight: 1,
        color: style.color,
        background: style.background
      }}
    >
      {children}
    </span>
  );
}

export function SectionTitle({
  title,
  subtitle
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{title}</h2>
      <p style={{ margin: "0.35rem 0 0", color: "#92a7c6", fontSize: "0.92rem" }}>{subtitle}</p>
    </div>
  );
}

function statusColor(status: SourceStatus): string {
  switch (status) {
    case "healthy":
      return "#7de2d1";
    case "degraded":
      return "#ffcf6e";
    case "restricted":
      return "#ff7b9c";
    default:
      return "#92a7c6";
  }
}

export function StatusRow({
  label,
  status,
  value,
  detail
}: {
  label: string;
  status: SourceStatus;
  value: string;
  detail: string;
}) {
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.8rem",
          alignItems: "center"
        }}
      >
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
          <span
            style={{
              width: "0.65rem",
              height: "0.65rem",
              borderRadius: "999px",
              background: statusColor(status),
              boxShadow: `0 0 14px ${statusColor(status)}`
            }}
          />
          <strong style={{ textTransform: "capitalize" }}>{label}</strong>
        </div>
        <span style={{ color: "#92a7c6", fontSize: "0.85rem" }}>{value}</span>
      </div>
      <div style={{ color: "#92a7c6", fontSize: "0.85rem" }}>{detail}</div>
    </div>
  );
}

export function StackCard({ stack }: { stack: InformationStack }) {
  return (
    <article
      style={{
        padding: "1rem",
        borderRadius: "1rem",
        border: "1px solid rgba(120, 162, 212, 0.24)",
        background: "rgba(6, 16, 28, 0.82)"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          alignItems: "start"
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>{stack.title}</h3>
          <p style={{ margin: "0.45rem 0 0", color: "#92a7c6", fontSize: "0.9rem" }}>{stack.summary}</p>
        </div>
        <Badge tone={stack.policy.restricted ? "neutral" : "accent"}>
          {Math.round(stack.confidence * 100)}%
        </Badge>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "0.85rem" }}>
        {stack.sources.map((source) => (
          <Badge key={`${stack.id}-${source}`} tone="neutral">
            {source}
          </Badge>
        ))}
      </div>
      <p style={{ margin: "0.8rem 0 0", fontSize: "0.92rem" }}>{stack.plainEnglish}</p>
    </article>
  );
}

export function TimelineBar({
  marks
}: {
  marks: Array<{ label: string; value: number; caption: string }>;
}) {
  return (
    <div style={{ display: "grid", gap: "0.8rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${marks.length}, minmax(0, 1fr))`,
          gap: "0.7rem"
        }}
      >
        {marks.map((mark) => (
          <div key={mark.label} style={{ display: "grid", gap: "0.35rem" }}>
            <div
              style={{
                height: `${Math.max(20, mark.value * 12)}px`,
                borderRadius: "999px",
                background: "linear-gradient(180deg, #59c7ff, #7de2d1)"
              }}
            />
            <strong style={{ fontSize: "0.82rem" }}>{mark.label}</strong>
            <span style={{ color: "#92a7c6", fontSize: "0.8rem" }}>{mark.caption}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
