import React from "react";
import type { LucideIcon } from "lucide-react";

type Props = {
  onClearCurrent: () => void;
  onLoad: () => void;
  onSave: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileChange: React.ChangeEventHandler<HTMLInputElement>;
  Icons: {
    Trash2: LucideIcon;
    FolderDown: LucideIcon;
    Save: LucideIcon;
  };
};

export default function BuilderHeaderActions({
  onClearCurrent,
  onLoad,
  onSave,
  fileInputRef,
  onFileChange,
  Icons,
}: Props) {
  const { Trash2, FolderDown, Save } = Icons;

  return (
    <div className="tsq-actions">
      <button
        className="tsq-icon-btn danger"
        onClick={onClearCurrent}
        title="Clear all tests in current tab"
      >
        <Trash2 size={18} />
      </button>

      <button
        className="tsq-icon-btn ghost"
        onClick={onLoad}
        title="Load test plan"
      >
        <FolderDown size={18} />
      </button>

      <button
        className="tsq-icon-btn primary"
        onClick={onSave}
        title="Save test plan"
      >
        <Save size={18} />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
}
