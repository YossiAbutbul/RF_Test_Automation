import React from "react";
import { ChevronDown, GripVertical, Trash2, PlayCircle } from "lucide-react";
import type { Protocol, TestItem } from "./types.ts";
import { isFreqAccuracy, isObw } from "./helpers";

type Props = {
  t: TestItem;
  tab: Protocol;
  headerFreqLabel: string;
  headerPowerLabel: string | null;
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
      ].join(" ")}
      draggable
      onDragStart={(e) => onDragStart(e, t.id)}
      onDragOver={(e) => onDragOver(e, t.id)}
      onDrop={(e) => onDrop(e, t.id)}
      onDragEnd={onDragEnd}
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
              <span className="tsq-test-proto">&nbsp;{headerFreqLabel}</span>
              {headerPowerLabel && (
                <span className="tsq-test-proto">&nbsp;{headerPowerLabel}</span>
              )}
            </span>
            <ChevronDown
              size={16}
              className={`tsq-title-caret ${t.minimized ? "" : "is-open"}`}
            />
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
          {/* Common name */}
          <div className="tsq-form-row">
            <label>Test Name</label>
            <input className="tsq-input" value={t.name} disabled />
          </div>

          {/* Shared frequency & power */}
          <div className="tsq-form-grid">
            <div className="tsq-form-row">
              <label>Frequency [MHz]</label>
              <input
                className="tsq-input"
                value={t.frequencyText ?? ""}
                placeholder={
                  tab === "LoRa" ? "e.g., 918.5" : tab === "LTE" ? "Mapped from EARFCN" : "e.g., 2402"
                }
                onChange={(e) => onUpdate({ frequencyText: e.target.value })}
              />
            </div>
            <div className="tsq-form-row">
              <label>Power [dBm]</label>
              <input
                className="tsq-input"
                type="number"
                value={t.powerText ?? ""}
                placeholder={tab === "LTE" ? "23" : tab === "LoRa" ? "14" : "0"}
                onChange={(e) => onUpdate({ powerText: e.target.value })}
              />
            </div>
          </div>

          {/* -------- FREQUENCY ACCURACY -------- */}
          {isFrequencyAccuracy ? (
            <div className="tsq-form-row">
              <label>PPM Limit</label>
              <input
                className="tsq-input"
                type="number"
                value={t.ppmLimit ?? (tab === "BLE" ? 40 : 20)}
                onChange={(e) =>
                  onUpdate({
                    ppmLimit:
                      e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
          ) : obw ? (
            <>
              {/* -------- OBW -------- */}
              {tab === "LoRa" && (
                <div className="tsq-form-grid">
                  <div className="tsq-form-row">
                    <label>Bandwidth Param</label>
                    <input
                      className="tsq-input"
                      placeholder="0–2"
                      value={t.bandwidthParam ?? ""}
                      onChange={(e) => onUpdate({ bandwidthParam: e.target.value })}
                    />
                  </div>
                  <div className="tsq-form-row">
                    <label>Data Rate Param</label>
                    <input
                      className="tsq-input"
                      placeholder="0–13"
                      value={t.dataRateParam ?? ""}
                      onChange={(e) => onUpdate({ dataRateParam: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {tab === "LTE" && (
                <>
                  <div className="tsq-form-grid">
                    <div className="tsq-form-row">
                      <label>MCS</label>
                      <input
                        className="tsq-input"
                        placeholder="default 5"
                        value={t.mcs ?? "5"}
                        onChange={(e) => onUpdate({ mcs: e.target.value })}
                      />
                    </div>
                    <div className="tsq-form-row">
                      <label>NB Index</label>
                      <input
                        className="tsq-input"
                        placeholder="default 0"
                        value={t.nbIndex ?? "0"}
                        onChange={(e) => onUpdate({ nbIndex: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="tsq-form-grid">
                    <div className="tsq-form-row">
                      <label>Num of RB Allocation</label>
                      <input
                        className="tsq-input"
                        placeholder="Enter number"
                        value={t.numRbAlloc ?? ""}
                        onChange={(e) => onUpdate({ numRbAlloc: e.target.value })}
                      />
                    </div>
                    <div className="tsq-form-row">
                      <label>Position of RB Allocation</label>
                      <input
                        className="tsq-input"
                        placeholder="Enter position"
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
                      placeholder="default 1"
                      value={t.dataLength ?? "1"}
                      onChange={(e) => onUpdate({ dataLength: e.target.value })}
                    />
                  </div>
                  <div className="tsq-form-row">
                    <label>Payload Pattern</label>
                    <input
                      className="tsq-input"
                      placeholder="default 1"
                      value={t.payloadPattern ?? "1"}
                      onChange={(e) => onUpdate({ payloadPattern: e.target.value })}
                    />
                  </div>
                  <div className="tsq-form-row">
                    <label>PHY Type</label>
                    <input
                      className="tsq-input"
                      placeholder="default 2"
                      value={t.phyType ?? "2"}
                      onChange={(e) => onUpdate({ phyType: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            // Regular Tx Power card
            <div className="tsq-form-grid">
              <div className="tsq-form-row">
                <label>Min Value [dBm]</label>
                <input
                  className="tsq-input"
                  type="number"
                  value={t.minValue ?? ""}
                  onChange={(e) =>
                    onUpdate({
                      minValue:
                        e.target.value === "" ? undefined : Number(e.target.value),
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
                      maxValue:
                        e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
