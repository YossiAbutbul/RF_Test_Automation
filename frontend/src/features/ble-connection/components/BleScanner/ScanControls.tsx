// frontend/src/features/ble-connection/components/BleScanner/ScanControls.tsx

import { RefreshCcw, StopCircle } from "lucide-react";
import type { ProjectFamily } from "../../types/ble.types";

interface ScanControlsProps {
  projectFamilies: ProjectFamily[];
  selectedFamilyId: string;
  scanning: boolean;
  scanSecondsLeft: number | null;
  onFamilyChange: (familyId: string) => void;
  onScan: () => void;
  onCancel: () => void;
}

export default function ScanControls({
  projectFamilies,
  selectedFamilyId,
  scanning,
  scanSecondsLeft,
  onFamilyChange,
  onScan,
  onCancel,
}: ScanControlsProps) {
  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Project Family Selector */}
      <div className="md:col-span-2">
        <label className="tsq-field-label">Project family</label>
        <select
          className="tsq-select"
          value={selectedFamilyId || ""}
          onChange={(e) => onFamilyChange(e.target.value)}
        >
          {projectFamilies.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* Scan/Stop Buttons */}
      <div className="flex items-end gap-2">
        {!scanning ? (
          <button
            className="tsq-btn ghost"
            onClick={onScan}
            disabled={!selectedFamilyId}
            title={
              selectedFamilyId
                ? "Scan for BLE devices"
                : "Select a project family first"
            }
          >
            <RefreshCcw className="h-4 w-4" />
            Scan
          </button>
        ) : (
          <button className="tsq-btn ghost" onClick={onCancel}>
            <StopCircle className="h-4 w-4" />
            Stop
            {scanSecondsLeft !== null && (
              <span className="ml-1 text-xs text-zinc-500">
                ({scanSecondsLeft}s)
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}