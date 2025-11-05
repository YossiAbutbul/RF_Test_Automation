// frontend/src/pages/TestSequence/components/EmptyState.tsx

export default function EmptyState() {
  return (
    <div className="tsq-empty-wrap">
      <div className="tsq-empty-icon">📥</div>
      <div className="tsq-empty-title">No tests yet</div>
      <div className="tsq-empty-sub">
        Drag a test from the right or drop a plan JSON here
      </div>
    </div>
  );
}