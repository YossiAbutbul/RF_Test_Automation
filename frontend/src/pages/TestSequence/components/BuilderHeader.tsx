// frontend/src/pages/TestSequence/components/BuilderHeader.tsx

import { Trash2, FolderDown, Save } from "lucide-react";
import type { Protocol } from "@/features/test-sequences/types/sequence.types";
import ProtocolTabs from "./ProtocolTabs";

interface BuilderHeaderProps {
  tab: Protocol;
  sequences: Record<Protocol, any[]>;
  onTabChange: (protocol: Protocol) => void;
  onClearCurrent: () => void;
  onLoad: () => void;
  onSave: () => void;
}

export default function BuilderHeader({
  tab,
  sequences,
  onTabChange,
  onClearCurrent,
  onLoad,
  onSave,
}: BuilderHeaderProps) {
  return (
    <div className="tsq-card-head">
      {/* Left side: Tabs + Title */}
      <div className="tsq-head-left">
        <ProtocolTabs tab={tab} sequences={sequences} onTabChange={onTabChange} />

        <div className="tsq-card-title mt-2">{tab} Builder</div>
        <div className="tsq-card-sub">
          Drag tests from the library or drop a JSON plan to load
        </div>
      </div>

      {/* Right side: Actions */}
      <div className="tsq-actions">
        {/* Delete current tab */}
        <button
          className="tsq-icon-btn danger"
          onClick={onClearCurrent}
          title={`Clear all tests in ${tab}`}
        >
          <Trash2 size={18} />
        </button>

        {/* Load */}
        <button className="tsq-icon-btn ghost" onClick={onLoad} title="Load test plan">
          <FolderDown size={18} />
        </button>

        {/* Save */}
        <button className="tsq-icon-btn primary" onClick={onSave} title="Save test plan">
          <Save size={18} />
        </button>
      </div>
    </div>
  );
}