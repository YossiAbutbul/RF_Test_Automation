// frontend/src/pages/TestSequence/components/TestCard.tsx

import { ChevronDown, GripVertical, Trash2, PlayCircle } from "lucide-react";
import type { Protocol, TestItem } from "@/features/test-sequences/types/sequence.types";
import {
  parseFirstFreqHz,
  parseFirstInt,
  formatMHzLabel,
  isFreqAccuracy,
  isOBW,
  getDefaultFreqHz,
  getDefaultPowerDbm,
} from "@/features/test-sequences/utils/sequenceHelpers";

interface TestCardProps {
  test: TestItem;
  protocol: Protocol;
  isDragging: boolean;
  isDragOver: boolean;
  dragOverEdge: "above" | "below" | null;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, id: number) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, id: number) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, id: number) => void;
  onDragEnd: () => void;
  onToggleMinimize: (id: number) => void;
  onRemove: (id: number) => void;
  onPlay: (test: TestItem) => void;
  onUpdate: (id: number, patch: Partial<TestItem>) => void;
}

export default function TestCard({
  test,
  protocol,
  isDragging,
  isDragOver,
  dragOverEdge,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggleMinimize,
  onRemove,
  onPlay,
  onUpdate,
}: TestCardProps) {
  const isFA = isFreqAccuracy(test);
  const isObw = isOBW(test);

  // Calculate header display values
  const hzFromInput = parseFirstFreqHz(test.frequencyText);
  const headerHz = hzFromInput || getDefaultFreqHz(protocol);
  const headerFreqLabel = formatMHzLabel(headerHz);

  let headerPowerLabel: string | null = null;
  if (!isFA && !isObw && (protocol === "LoRa" || protocol === "LTE")) {
    const parsed = parseFirstInt(test.powerText);
    const powerDbm =
      Number.isFinite(parsed) && parsed !== 0 ? parsed : getDefaultPowerDbm(protocol);
    headerPowerLabel = `${powerDbm}dBm`;
  }

  const cardClasses = [
    "tsq-test-card",
    isDragging ? "is-dragging" : "",
    isDragOver ? `is-over-${dragOverEdge}` : "",
    !test.minimized ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cardClasses}
      draggable
      onDragStart={(e) => onDragStart(e, test.id)}
      onDragOver={(e) => onDragOver(e, test.id)}
      onDrop={(e) => onDrop(e, test.id)}
      onDragEnd={onDragEnd}
    >
      {/* Header */}
      <header className="tsq-test-head">
        <div className="tsq-test-title">
          <span className="tsq-test-drag-handle" title="Drag to reorder">
            <GripVertical size={16} />
          </span>

          <button
            className="tsq-title-toggle"
            onClick={() => onToggleMinimize(test.id)}
            title={test.minimized ? "Expand" : "Minimize"}
          >
            <span className="tsq-title-text">
              <span className="tsq-test-proto">{protocol}</span>
              <ChevronDown
                className={`tsq-title-caret ${!test.minimized ? "is-open" : ""}`}
                size={16}
              />
              <span>{test.name}</span>
            </span>
          </button>

          {/* Header badges */}
          {headerFreqLabel && (
            <span className="tsq-test-badge">{headerFreqLabel}</span>
          )}
          {headerPowerLabel && (
            <span className="tsq-test-badge">{headerPowerLabel}</span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="tsq-icon-btn"
            onClick={() => onPlay(test)}
            title="Run test"
          >
            <PlayCircle size={16} />
          </button>
          <button
            className="tsq-icon-btn danger"
            onClick={() => onRemove(test.id)}
            title="Delete test"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {/* Body (only show when not minimized) */}
      {!test.minimized && (
        <div className="tsq-test-body">
          <div className="tsq-fields">
            {/* Test Name */}
            <label className="tsq-field">
              <span>Test Name</span>
              <input
                className="tsq-input"
                value={test.name}
                onChange={(e) => onUpdate(test.id, { name: e.target.value })}
                placeholder={test.type}
              />
            </label>

            {/* Frequency */}
            <label className="tsq-field">
              <span>Frequency</span>
              <input
                className="tsq-input"
                value={test.frequencyText || ""}
                onChange={(e) => onUpdate(test.id, { frequencyText: e.target.value })}
                placeholder="e.g., 918.5 or 918500000"
              />
            </label>

            {/* Power (for Tx Power tests only) */}
            {!isFA && !isObw && (protocol === "LoRa" || protocol === "LTE") && (
              <label className="tsq-field">
                <span>Power [dBm]</span>
                <input
                  className="tsq-input"
                  value={test.powerText || ""}
                  onChange={(e) => onUpdate(test.id, { powerText: e.target.value })}
                  placeholder="e.g., 14 or 14,16,18"
                />
              </label>
            )}

            {/* BLE Power Parameter */}
            {!isFA && !isObw && protocol === "BLE" && (
              <label className="tsq-field">
                <span>Power Param (hex)</span>
                <input
                  className="tsq-input"
                  value={test.powerBle || ""}
                  onChange={(e) => onUpdate(test.id, { powerBle: e.target.value })}
                  placeholder="e.g., 0x1F or 31"
                />
              </label>
            )}

            {/* Min/Max for Tx Power */}
            {!isFA && !isObw && (
              <>
                <label className="tsq-field">
                  <span>Min [dBm] (optional)</span>
                  <input
                    className="tsq-input"
                    type="number"
                    value={test.minValue ?? ""}
                    onChange={(e) =>
                      onUpdate(test.id, {
                        minValue: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder="—"
                  />
                </label>
                <label className="tsq-field">
                  <span>Max [dBm] (optional)</span>
                  <input
                    className="tsq-input"
                    type="number"
                    value={test.maxValue ?? ""}
                    onChange={(e) =>
                      onUpdate(test.id, {
                        maxValue: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder="—"
                  />
                </label>
              </>
            )}

            {/* PPM Limit for Frequency Accuracy */}
            {isFA && (
              <label className="tsq-field">
                <span>PPM Limit</span>
                <input
                  className="tsq-input"
                  type="number"
                  value={test.ppmLimit ?? ""}
                  onChange={(e) =>
                    onUpdate(test.id, {
                      ppmLimit: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder="e.g., 20"
                />
              </label>
            )}

            {/* OBW Fields */}
            {isObw && protocol === "BLE" && (
              <>
                <label className="tsq-field">
                  <span>Data Length</span>
                  <input
                    className="tsq-input"
                    value={test.obwDataLength || ""}
                    onChange={(e) => onUpdate(test.id, { obwDataLength: e.target.value })}
                    placeholder="1"
                  />
                </label>
                <label className="tsq-field">
                  <span>Payload Pattern</span>
                  <input
                    className="tsq-input"
                    value={test.obwPayloadPattern || ""}
                    onChange={(e) => onUpdate(test.id, { obwPayloadPattern: e.target.value })}
                    placeholder="1"
                  />
                </label>
                <label className="tsq-field">
                  <span>PHY Type</span>
                  <input
                    className="tsq-input"
                    value={test.obwPhyType || ""}
                    onChange={(e) => onUpdate(test.id, { obwPhyType: e.target.value })}
                    placeholder="2"
                  />
                </label>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}