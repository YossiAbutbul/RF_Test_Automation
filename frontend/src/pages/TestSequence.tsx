import React, { useMemo, useRef, useState } from "react";
import { ChevronDown, GripVertical, PlayCircle, Plus, Trash2 } from "lucide-react";
import RunModal from "../components/RunModal";
import "./css/TestSequence.css";

/* ---------------- Types ---------------- */
type Protocol = "LoRa" | "LTE" | "BLE";

type TestItem = {
  id: number;
  type: string;
  name: string;
  minimized?: boolean;
  runCondition?: "Run Always" | "Run If Pass" | "Run If Fail";
  frequencyText?: string; // e.g. "918.5 MHz" or "918500000"
  powerText?: string;     // e.g. "14"
  // Tx Power limits:
  minValue?: number;
  maxValue?: number;
  // Frequency Accuracy:
  ppmLimit?: number;
  includeScreenshot?: boolean;
};

/* ---------------- Defaults ---------------- */
const TEST_LIBRARY = [
  "Tx Power",
  
  "Frequency Accuracy",
  
];

const BASE_DEFAULTS = {
  runCondition: "Run Always" as const,
  frequencyText: "918.5 MHz",
  powerText: "14",
  includeScreenshot: false,
};

/* ---------------- Helpers ---------------- */
function parseFirstFreqHz(text: string | number | undefined): number {
  if (text == null) return 0;
  const s = String(text).trim().replace(/,/g, "");
  const m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  // If user typed "918.5" assume MHz, else assume already in Hz
  return val < 1e6 ? Math.round(val * 1_000_000) : Math.round(val);
}
function parseFirstInt(text: string | number | undefined): number {
  if (text == null) return 0;
  const s = String(text);
  const first = s.split(",")[0].trim();
  const n = parseInt(first, 10);
  return Number.isFinite(n) ? n : 0;
}
const isFreqAccuracy = (t: TestItem | string) =>
  /frequency\s*accuracy/i.test(typeof t === "string" ? t : t.type);

/* ---------------- Component ---------------- */
export default function TestSequence() {
  const [tab, setTab] = useState<Protocol>("LoRa");
  const [sequences, setSequences] = useState<Record<Protocol, TestItem[]>>({
    LoRa: [],
    LTE: [],
    BLE: [],
  });
  const nextId = useRef(1);

  // DnD state
  const [draggingCardId, setDraggingCardId] = useState<number | null>(null);
  const [draggingLibTest, setDraggingLibTest] = useState<string | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<number | null>(null);
  const [dragOverEdge, setDragOverEdge] = useState<"before" | "after" | null>(null);

  // Run modal
  const [runOpen, setRunOpen] = useState(false);
  const [runDefaults, setRunDefaults] = useState<{
    freqHz: number;
    powerDbm: number;
    testName: string;
    type: string;
    minValue?: number;
    maxValue?: number;
    ppmLimit?: number;
    defaultMac?: string | null;
  } | null>(null);

  const totals = useMemo(
    () => ({
      LoRa: sequences.LoRa.length,
      LTE: sequences.LTE.length,
      BLE: sequences.BLE.length,
    }),
    [sequences]
  );
  const totalAll = totals.LoRa + totals.LTE + totals.BLE;

  /* ---------- Mutators ---------- */
  const addTestToCurrent = (name: string) => {
    const id = nextId.current++;
    setSequences((prev) => {
      const copy = { ...prev };
      const defaults: Partial<TestItem> = isFreqAccuracy(name)
        ? { ...BASE_DEFAULTS, ppmLimit: 20 } // default ±20 ppm
        : { ...BASE_DEFAULTS, minValue: undefined, maxValue: undefined };
      copy[tab] = [...copy[tab], { id, type: name, name, ...defaults }];
      // collapse previous tests, keep the newly added open
      copy[tab] = copy[tab].map((t, i, arr) => (i === arr.length - 1 ? t : { ...t, minimized: true }));
      return copy;
    });
  };

  const removeTest = (id: number) => {
    setSequences((prev) => {
      const copy = { ...prev };
      copy[tab] = copy[tab].filter((t) => t.id !== id);
      return copy;
    });
  };

  const toggleMinimize = (id: number) => {
    setSequences((prev) => {
      const copy = { ...prev };
      copy[tab] = copy[tab].map((t) => (t.id === id ? { ...t, minimized: !t.minimized } : t));
      return copy;
    });
  };

  const updateTest = (id: number, patch: Partial<TestItem>) => {
    setSequences((prev) => {
      const copy = { ...prev };
      copy[tab] = copy[tab].map((t) => (t.id === id ? { ...t, ...patch } : t));
      return copy;
    });
  };

  /* ---------- DnD: library → builder ---------- */
  const onBuilderDragOver = (e: React.DragEvent) => {
    if (draggingLibTest != null || draggingCardId != null) e.preventDefault();
  };
  const onBuilderDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggingLibTest) addTestToCurrent(draggingLibTest);
    setDraggingLibTest(null);
  };

  /* ---------- DnD: reorder ---------- */
  const onCardDragStart = (e: React.DragEvent, id: number) => {
    setDraggingCardId(id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onCardDragOver = (e: React.DragEvent, overId: number) => {
    e.preventDefault();
    if (draggingCardId == null || draggingCardId === overId) return;
    const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = bounds.top + bounds.height / 2;
    setDragOverCardId(overId);
    setDragOverEdge(e.clientY < mid ? "before" : "after");
  };
  const onCardDrop = (e: React.DragEvent, overId: number) => {
    e.preventDefault();
    if (draggingCardId == null || dragOverCardId == null || !dragOverEdge) return;
    setSequences((prev) => {
      const copy = { ...prev };
      const arr = [...copy[tab]];
      const fromIdx = arr.findIndex((t) => t.id === draggingCardId);
      const overIdx = arr.findIndex((t) => t.id === overId);
      if (fromIdx === -1 || overIdx === -1) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      const insertIdx = dragOverEdge === "before" ? overIdx : overIdx + 1;
      arr.splice(insertIdx, 0, moved);
      copy[tab] = arr;
      return copy;
    });
    setDraggingCardId(null);
    setDragOverCardId(null);
    setDragOverEdge(null);
  };
  const onCardDragEnd = () => {
    setDraggingCardId(null);
    setDragOverCardId(null);
    setDragOverEdge(null);
  };

  /* ---------- Play locally ---------- */
  const playSingle = (t: TestItem) => {
    const freqHz = parseFirstFreqHz(t.frequencyText);
    const powerDbm = parseFirstInt(t.powerText);
    const defaultMac = localStorage.getItem("rfapp.lastMac") || null;

    setRunDefaults({
      freqHz: freqHz || 918_500_000,
      powerDbm: Number.isFinite(powerDbm) ? powerDbm : 14,
      testName: t.name || t.type || "Test",
      type: t.type,
      minValue: t.minValue,
      maxValue: t.maxValue,
      ppmLimit: t.ppmLimit,
      defaultMac,
    });
    setRunOpen(true);
  };

  /* ---------- Render ---------- */
  return (
    <div className="tsq-container">
      <div className="tsq-header">
        <div>
          <div className="tsq-title">Test Sequence</div>
          <div className="tsq-subtitle">Define and run automated RF tests</div>
        </div>
        <div className="tsq-total">Total Tests: {totalAll}</div>
      </div>

      {/* Tabs */}
      <div className="tsq-tabs">
        {(["LoRa", "LTE", "BLE"] as const).map((p) => (
          <button key={p} className={`tsq-tab ${tab === p ? "is-active" : ""}`} onClick={() => setTab(p)}>
            {p}
            <span className="tsq-badge">{sequences[p].length}</span>
          </button>
        ))}
      </div>

      <div className="tsq-grid">
        {/* Builder */}
        <section
          className={`tsq-card tsq-builder ${draggingLibTest ? "is-drop-target" : ""}`}
          onDragOver={onBuilderDragOver}
          onDrop={onBuilderDrop}
        >
          <div className="tsq-card-head">
            <div>
              <div className="tsq-card-title">{tab} Builder</div>
              <div className="tsq-card-sub">Drag tests from the library or reorder existing tests</div>
            </div>
            <div className="tsq-actions">
              <button className="tsq-btn ghost">Load {tab.toUpperCase()}</button>
              <button className="tsq-btn primary">Save {tab.toUpperCase()}</button>
            </div>
          </div>

          {sequences[tab].length === 0 ? (
            <div className="tsq-dropzone">
              No {tab} tests yet
              <br />
              Drag tests from the library to get started
            </div>
          ) : (
            <div className="tsq-tests">
              {sequences[tab].map((t) => {
                const isFA = isFreqAccuracy(t);
                return (
                  <article
                    key={t.id}
                    className={[
                      "tsq-test",
                      t.minimized ? "is-min" : "",
                      draggingCardId === t.id ? "is-dragging" : "",
                      dragOverCardId === t.id && dragOverEdge ? `is-over is-${dragOverEdge}` : "",
                    ].join(" ")}
                    draggable
                    onDragStart={(e) => onCardDragStart(e, t.id)}
                    onDragOver={(e) => onCardDragOver(e, t.id)}
                    onDrop={(e) => onCardDrop(e, t.id)}
                    onDragEnd={onCardDragEnd}
                  >
                    <header className="tsq-test-head">
                      <div className="tsq-test-title">
                        <span className="tsq-test-drag-handle" title="Drag to reorder">
                          <GripVertical size={16} />
                        </span>
                        <button
                          className="tsq-title-toggle"
                          onClick={() => toggleMinimize(t.id)}
                          title={t.minimized ? "Expand" : "Minimize"}
                        >
                          <span className="tsq-title-text">
                            {t.type} <span className="tsq-test-proto"> &nbsp;· {tab}</span>
                          </span>
                          <ChevronDown size={16} className={`tsq-title-caret ${t.minimized ? "" : "is-open"}`} />
                        </button>
                      </div>

                      <div className="tsq-test-actions">
                        <button className="tsq-icon-btn ghost" title="Play locally" onClick={() => playSingle(t)}>
                          <PlayCircle size={18} />
                        </button>
                        <button className="tsq-icon-btn ghost danger" title="Remove" onClick={() => removeTest(t.id)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </header>

                    {!t.minimized && (
                      <div className="tsq-test-body">
                        <div className="tsq-form-row">
                          <label>Test Name</label>
                          <input
                            className="tsq-input"
                            value={t.name}
                            onChange={(e) => updateTest(t.id, { name: e.target.value })}
                          />
                        </div>

                        <div className="tsq-form-grid">
                          <div className="tsq-form-row">
                            <label>Run Condition</label>
                            <select
                              className="tsq-input"
                              value={t.runCondition ?? "Run Always"}
                              onChange={(e) =>
                                updateTest(t.id, {
                                  runCondition: e.target.value as TestItem["runCondition"],
                                })
                              }
                            >
                              <option>Run Always</option>
                              <option>Run If Pass</option>
                              <option>Run If Fail</option>
                            </select>
                          </div>

                          <div className="tsq-form-row">
                            <label>Frequency</label>
                            <input
                              className="tsq-input"
                              value={t.frequencyText ?? ""}
                              onChange={(e) => updateTest(t.id, { frequencyText: e.target.value })}
                              placeholder="e.g., 918.5 MHz or 918500000"
                            />
                          </div>
                        </div>

                        <div className="tsq-form-grid">
                          <div className="tsq-form-row">
                            <label>Power (dBm)</label>
                            <input
                              className="tsq-input"
                              value={String(t.powerText ?? "")}
                              onChange={(e) => updateTest(t.id, { powerText: e.target.value })}
                              placeholder="e.g., 14"
                            />
                          </div>

                          {/* Tx Power limits OR Freq Accuracy ppm limit */}
                          {!isFA ? (
                            <>
                              <div className="tsq-form-row">
                                <label>Min Value (dBm)</label>
                                <input
                                  className="tsq-input"
                                  type="number"
                                  value={t.minValue ?? ""}
                                  onChange={(e) =>
                                    updateTest(t.id, {
                                      minValue: e.target.value === "" ? undefined : Number(e.target.value),
                                    })
                                  }
                                />
                              </div>

                              <div className="tsq-form-row">
                                <label>Max Value (dBm)</label>
                                <input
                                  className="tsq-input"
                                  type="number"
                                  value={t.maxValue ?? ""}
                                  onChange={(e) =>
                                    updateTest(t.id, {
                                      maxValue: e.target.value === "" ? undefined : Number(e.target.value),
                                    })
                                  }
                                />
                              </div>
                            </>
                          ) : (
                            <div className="tsq-form-row">
                              <label>PPM Limit (±)</label>
                              <input
                                className="tsq-input"
                                type="number"
                                value={t.ppmLimit ?? 20}
                                onChange={(e) =>
                                  updateTest(t.id, {
                                    ppmLimit: e.target.value === "" ? undefined : Number(e.target.value),
                                  })
                                }
                                placeholder="e.g., 20 (ppm)"
                              />
                            </div>
                          )}
                        </div>

                        <label className="tsq-check">
                          <input
                            type="checkbox"
                            checked={!!t.includeScreenshot}
                            onChange={(e) => updateTest(t.id, { includeScreenshot: e.target.checked })}
                          />{" "}
                          Include Spectrum Screenshot
                        </label>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Library */}
        <aside className="tsq-card tsq-library">
          <div className="tsq-card-head">
            <div>
              <div className="tsq-card-title">Available Tests</div>
              <div className="tsq-card-sub">Drag tests to the {tab} builder</div>

            </div>
            {/* <button className="tsq-btn ghost">
              <Plus className="mr-1" size={16} /> Add
            </button> */}
          </div>

          <div className="tsq-library-list">
            {TEST_LIBRARY.map((name) => (
              <div
                key={name}
                className="tsq-lib-item"
                draggable
                onDragStart={() => setDraggingLibTest(name)}
                onDoubleClick={() => addTestToCurrent(name)}
                title="Drag to add • Double-click to add"
              >
                <div>
                  <div className="tsq-lib-name">{name}</div>
                  <div className="tsq-lib-sub">Drag to add</div>
                </div>
                <button className="tsq-icon-btn" onClick={() => addTestToCurrent(name)} title="Quick Add">
                  +
                </button>
              </div>
            ))}
          </div>

          <div className="tsq-quick">
            <div className="tsq-quick-title">Quick Actions</div>
            <div className="tsq-quick-grid">
              <button className="tsq-btn">Load Template</button>
              <button className="tsq-btn">Save as Template</button>
            </div>
          </div>
        </aside>
      </div>

      {/* Run modal */}
      {runOpen && runDefaults && (
        <RunModal
          open={runOpen}
          onClose={() => setRunOpen(false)}
          // mode by test type
          mode={isFreqAccuracy(runDefaults.type) ? "freqAccuracy" : "txPower"}
          testName={runDefaults.testName}
          defaultFreqHz={runDefaults.freqHz}
          defaultPowerDbm={runDefaults.powerDbm}
          defaultMac={runDefaults.defaultMac || undefined}
          // tx-power limits
          minValue={runDefaults.minValue}
          maxValue={runDefaults.maxValue}
          // freq-accuracy default tolerance
          defaultPpmLimit={runDefaults.ppmLimit ?? 20}
        />
      )}
    </div>
  );
}
