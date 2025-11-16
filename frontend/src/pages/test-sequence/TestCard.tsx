import React from "react";
import { ChevronDown, GripVertical, Trash2, PlayCircle } from "lucide-react";
import type { Protocol, TestItem } from "./types.ts";
import { isFreqAccuracy, isObw } from "./helpers";

type Props = {
  t: TestItem;
  tab: Protocol;
  headerFreqLabel: string;       // may be "" to hide
  headerPowerLabel: string | null; // may be null to hide
  draggingCardId: number | null;
  dragOverCardId: number | null;
  dragOverEdge: "above" | "below" | null;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, id: number) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, id: number) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, id: number) => void;
  onDragEnd: () => void;
  onToggle: () => void;
  onRun: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<TestItem>) => void;
  isFrequencyAccuracy: boolean;
};

export default function TestCard({
  t,
  tab,
  headerFreqLabel,
  headerPowerLabel,
  draggingCardId,
  dragOverCardId,
  dragOverEdge,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggle,
  onRun,
  onRemove,
  onUpdate,
  isFrequencyAccuracy,
}: Props) {
  const obw = isObw(t);

  return (
    <div
        className={[
            "tsq-test-card",
            draggingCardId === t.id ? "is-dragging" : "",
            dragOverCardId === t.id ? `is-over-${dragOverEdge}` : "",
            t.minimized ? "draggable" : "not-draggable",
        ].join(" ")}
        draggable={t.minimized}
        onDragStart={(e) => {
            if (t.minimized) onDragStart(e, t.id);
        }}
        onDragOver={(e) => {
            if (t.minimized) onDragOver(e, t.id);
        }}
        onDrop={(e) => {
            if (t.minimized) onDrop(e, t.id);
        }}
        onDragEnd={(e) => {
            if (t.minimized) onDragEnd();
        }}
        >

      <header className="tsq-test-head">
        <div className="tsq-test-title">
          <span className="tsq-test-drag-handle" title="Drag to reorder">
            <GripVertical size={16} />
          </span>
          <button
            className="tsq-title-toggle"
            onClick={onToggle}
            title={t.minimized ? "Expand" : "Minimize"}
          >
            <span className="tsq-title-text">
              {t.type}
              <span className="tsq-test-proto">&nbsp;· {tab}</span>

              {/* Only show if user provided value; no silent default in header */}
              {headerFreqLabel && <span className="tsq-test-proto">&nbsp;{headerFreqLabel}</span>}
              {headerPowerLabel && <span className="tsq-test-proto">&nbsp;{headerPowerLabel}</span>}

              {/* NEW: LoRa OBW — show Data Rate in header when provided */}
              {obw &&
                tab === "LoRa" &&
                (t.dataRateParam ?? "").trim() !== "" && (
                  <span className="tsq-test-proto">&nbsp;DR {t.dataRateParam}</span>
                )}
            </span>
            <ChevronDown size={16} className={`tsq-title-caret ${t.minimized ? "" : "is-open"}`} />
          </button>
        </div>

        <div className="tsq-test-actions">
          <button className="tsq-icon-btn ghost" title="Run this test" onClick={onRun}>
            <PlayCircle size={18} />
          </button>
          <button className="tsq-icon-btn ghost danger" title="Remove" onClick={onRemove}>
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {!t.minimized && (
        <div className="tsq-test-body">
          {/* Name (locked) */}
          <div className="tsq-form-row">
            <label>Test Name</label>
            <input className="tsq-input" value={t.name} onChange={(e) => onUpdate({ name: e.target.value })} disabled />
          </div>

          {/* Frequency & power (note: power accepts 0) */}
          <div className="tsq-form-grid">
            <div className="tsq-form-row">
              <label>Frequency [MHz]</label>
              <input
                className="tsq-input"
                value={t.frequencyText ?? ""} // already prefilled on create; clearing makes header hide it
                onChange={(e) => onUpdate({ frequencyText: e.target.value })}
              />
            </div>

            {/* Power for LoRa/LTE (BLE uses power parameter only in Tx Power test) */}
            {tab !== "BLE" && (
              <div className="tsq-form-row">
                <label>Power [dBm]</label>
                <input
                  className="tsq-input"
                  type="number"
                  value={t.powerText ?? ""} // "0" is valid; empty string means unset
                  onChange={(e) => onUpdate({ powerText: e.target.value })}
                />
              </div>
            )}
          </div>

          {/* Conditional sections */}
          {isFrequencyAccuracy ? (
            <div className="tsq-form-row">
              <label>PPM Limit</label>
              <input
                className="tsq-input"
                type="number"
                value={t.ppmLimit ?? (tab === "BLE" ? 40 : 20)}
                onChange={(e) => onUpdate({ ppmLimit: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </div>
          ) : obw ? (
            <>
              {tab === "LoRa" && (
                <div className="tsq-form-grid">
                  <div className="tsq-form-row">
                    <label>Bandwidth Param</label>
                    <input
                      className="tsq-input"
                      value={t.bandwidthParam ?? ""}
                      onChange={(e) => onUpdate({ bandwidthParam: e.target.value })}
                    />
                  </div>
                  <div className="tsq-form-row">
                    <label>Data Rate Param</label>
                    <input
                      className="tsq-input"
                      value={t.dataRateParam ?? ""}
                      onChange={(e) => onUpdate({ dataRateParam: e.target.value })}
                    />
                  </div>
                  <label className="tsq-field">
                    <span>Max OBW [kHz] (optional)</span>
                    <input
                      className="tsq-input"
                      type="number"
                      placeholder="—"
                      value={t.maxObwKhz ?? "130"}
                      onChange={(e) =>
                        onUpdate({
                          maxObwKhz: e.currentTarget.value === "" ? null : Number(e.currentTarget.value),
                        })
                      }
                    />
                  </label>
                </div>
              )}

              {tab === "LTE" && (
                <>
                  <div className="tsq-form-grid">
                    <div className="tsq-form-row">
                      <label>MCS</label>
                      <input
                        className="tsq-input"
                        value={t.mcs ?? "5"}
                        onChange={(e) => onUpdate({ mcs: e.target.value })}
                      />
                    </div>
                    <div className="tsq-form-row">
                      <label>NB Index</label>
                      <input
                        className="tsq-input"
                        value={t.nbIndex ?? "0"}
                        onChange={(e) => onUpdate({ nbIndex: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="tsq-form-grid">
                    <div className="tsq-form-row">
                      <label>Number of RB Allocation</label>
                      <input
                        className="tsq-input"
                        value={t.numRbAlloc ?? "6"}
                        onChange={(e) => onUpdate({ numRbAlloc: e.target.value })}
                      />
                    </div>
                    <div className="tsq-form-row">
                      <label>Position of RB Allocation</label>
                      <input
                        className="tsq-input"
                        value={t.posRbAlloc ?? ""}
                        onChange={(e) => onUpdate({ posRbAlloc: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}

              {tab === "BLE" && (
                <div className="tsq-form-grid">
                  <div className="tsq-form-row">
                    <label>Data Length</label>
                    <input
                      className="tsq-input"
                      value={t.dataLength ?? "1"}
                      onChange={(e) => onUpdate({ dataLength: e.target.value })}
                    />
                  </div>
                  <div className="tsq-form-row">
                    <label>Payload Pattern</label>
                    <input
                      className="tsq-input"
                      value={t.payloadPattern ?? "1"}
                      onChange={(e) => onUpdate({ payloadPattern: e.target.value })}
                    />
                  </div>
                  <div className="tsq-form-row">
                    <label>PHY Type</label>
                    <input
                      className="tsq-input"
                      value={t.phyType ?? "2"}
                      onChange={(e) => onUpdate({ phyType: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            // Regular Tx Power card (LoRa/LTE)
            tab !== "BLE" && (
              <div className="tsq-form-grid">
                <div className="tsq-form-row">
                  <label>Min Value [dBm]</label>
                  <input
                    className="tsq-input"
                    type="number"
                    value={t.minValue ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        minValue: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="tsq-form-row">
                  <label>Max Value [dBm]</label>
                  <input
                    className="tsq-input"
                    type="number"
                    value={t.maxValue ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        maxValue: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            )
          )}

          {/* BLE Power Parameter (Tx Power only) */}
          {!isFrequencyAccuracy && !obw && tab === "BLE" && (
            <div className="tsq-form-row">
              <label>Power Parameter (hex)</label>
              <input
                className="tsq-input"
                value={t.powerBle ?? "31"}
                onChange={(e) => onUpdate({ powerBle: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
