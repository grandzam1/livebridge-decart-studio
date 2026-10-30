export const dynamic = "force-dynamic";

export default function StandbyPage() {
  return (
    <main className="obs-standby" aria-label="Waiting for live session">
      <div className="obs-standby-orbit">
        <span className="obs-standby-core" />
        <span className="obs-standby-ring obs-standby-ring-one" />
        <span className="obs-standby-ring obs-standby-ring-two" />
      </div>
      <p className="obs-standby-eyebrow">LIVEBRIDGE</p>
      <h1 className="obs-standby-title">Waiting for live session</h1>
      <p className="obs-standby-detail">The transformed video will appear here when the studio goes live.</p>
      <div className="obs-standby-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}
