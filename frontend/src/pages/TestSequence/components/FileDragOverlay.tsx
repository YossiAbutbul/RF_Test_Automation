// frontend/src/pages/TestSequence/components/FileDragOverlay.tsx

interface FileDragOverlayProps {
  active: boolean;
}

export default function FileDragOverlay({ active }: FileDragOverlayProps) {
  if (!active) return null;

  return (
    <div className="tsq-file-overlay">
      <div className="tsq-file-overlay-inner">
        <div className="tsq-file-icon">📄</div>
        <div className="tsq-file-title">Drop RF Test Plan (.json) to Load</div>
        <div className="tsq-file-sub">
          This will replace the current builder state for all protocols
        </div>
      </div>
    </div>
  );
}