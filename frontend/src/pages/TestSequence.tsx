import React, { useMemo, useRef, useState } from "react";
import { ChevronDown, GripVertical, PlayCircle, Plus, Trash2 } from "lucide-react";
import RunModal from "../components/modals/RunModal";
import "./css/TestSequence.css";

/* ---------------- Types ---------------- */
type Protocol = "LoRa" | "LTE" | "BLE";

type TestItem = {
  id: number;
  type: string;
  name: string;
  minimized?: boolean;
  runCondition?: "Run Always" | "Run If Pass" | "Run If Fail";
  frequencyText?: string;  // e.g. "918.5" or "918500000"
  powerText?: string;      // LoRa/LTE: e.g. "14"
  powerBle?: string;       // BLE: e.g. "0x1F"
  minValue?: number;
  maxValue?: number;

  // Frequency Accuracy only
  ppmLimit?: number;

  includeScreenshot?: boolean;
};

type RunDefaults = {
  testName: string;
  type: string;
  freqHz: number;
  powerDbm?: number;               // LoRa/LTE only (optional now)
  powerBle?: string;               // BLE hex (e.g. "0x1F")
  minValue?: number | null;        // can be null in callers
  maxValue?: number | null;        // can be null in callers
  ppmLimit?: number;
  defaultMac?: string | null;
};

/* ---------------- Defaults ---------------- */
const TEST_LIBRARY = ["Tx Power", "Frequency Accuracy"];

const BASE_DEFAULTS = {
  runCondition: "Run Always" as const,
  frequencyText: "918.5", // LoRa default shown in input without "MHz"
  powerText: "14",
  minimized: false,
  includeScreenshot: true,
};

// Helpers to parse the first number in a string
const NUM_RE = /[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i;
function parseFirstFreqHz(text: string | number | undefined): number {
  if (text == null) return 0;
  const s = String(text);
  const m = s.match(NUM_RE);
  if (!m) return 0;
  const val = parseFloat(m[0]); // use the matched token
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

  const [draggingLibTest, setDraggingLibTest] = useState<string | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<number | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<number | null>(null);
  const [dragOverEdge, setDragOverEdge] = useState<"above" | "below" | null>(null);

  const nextId = useRef(1);

  const [runOpen, setRunOpen] = useState(false);
  const [runDefaults, setRunDefaults] = useState<RunDefaults | null>(null);

  const totalAll = useMemo(
    () => sequences.LoRa.length + sequences.LTE.length + sequences.BLE.length,
    [sequences]
  );

  /* ---------- Helpers to update a test ---------- */
  const updateTest = (id: number, patch: Partial<TestItem>) => {
    setSequences((prev) => {
      const copy: Record<Protocol, TestItem[]> = { ...prev };
      copy[tab] = copy[tab].map((t) => (t.id === id ? { ...t, ...patch } : t));
      return copy;
    });
  };

  /* ---------- Add from library ---------- */
  const addTestToCurrent = (name: string) => {
    const id = nextId.current++;
    setSequences((prev) => {
      const copy = { ...prev };

      // Per-tab defaults (fix #2): LTE cards start with 1880 MHz & 23 dBm
      const base = isFreqAccuracy(name)
        ? { ...BASE_DEFAULTS, ppmLimit: 20 }
        : { ...BASE_DEFAULTS, minValue: undefined, maxValue: undefined };

      const tabDefaults: Partial<TestItem> =
        tab === "LTE"
          ? { frequencyText: "1880", powerText: "23" }
          : tab === "LoRa"
          ? { frequencyText: "918.5", powerText: "14" }
          : { frequencyText: "2402", powerBle: "31" };


      copy[tab] = [...copy[tab], { id, type: name, name, ...base, ...tabDefaults }];

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

  /* ---------- Drag & Drop (cards) ---------- */
  const onCardDragStart = (e: React.DragEvent<HTMLDivElement>, id: number) => {
    setDraggingCardId(id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onCardDragOver = (e: React.DragEvent<HTMLDivElement>, id: number) => {
    e.preventDefault();
    if (draggingCardId == null) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDragOverCardId(id);
    setDragOverEdge(e.clientY < mid ? "above" : "below");
  };
  const onCardDrop = (e: React.DragEvent<HTMLDivElement>, id: number) => {
    e.preventDefault();
    setSequences((prev) => {
      const list = [...prev[tab]];
      const from = list.findIndex((t) => t.id === draggingCardId);
      const to = list.findIndex((t) => t.id === id);
      if (from === -1 || to === -1) return prev;
      const [item] = list.splice(from, 1);
      const insertAt = to + (dragOverEdge === "below" ? 1 : 0);
      list.splice(insertAt, 0, item);
      return { ...prev, [tab]: list };
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

  /* ---------- Drag from Library ---------- */
  const onBuilderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onBuilderDrop = () => {
    if (!draggingLibTest) return;
    addTestToCurrent(draggingLibTest);
    setDraggingLibTest(null);
  };

  /* ---------- Play locally ---------- */
  const playSingle = (t: TestItem) => {
    const freqHz = parseFirstFreqHz(t.frequencyText);

    // LoRa/LTE power (numeric string -> int)
    const powerDbm = parseFirstInt(t.powerText);

    // BLE power (hex string, e.g. "0x1F" or "1F")
    const powerBle = (t.powerBle || "").trim();

    let defaultMac: string | null = null;
    if (tab === "LTE") defaultMac = "80E1271FD8DD";

    // Keep your existing naming logic (fine with the new wrapper)
    const nameForModal =
      tab === "LTE"
        ? `LTE ${t.type || "Test"}`
        : tab === "LoRa"
        ? `LoRa ${t.type || "Test"}`
        : t.type || "Test";

    // Build runDefaults per protocol (so the wrapper can pass the right defaults)
    if (tab === "BLE") {
      setRunDefaults({
        testName: nameForModal,
        type: t.type,
        freqHz: freqHz || 2_402_000_000,           // BLE default 2402 MHz
        // no numeric power for BLE; store hex so the wrapper can pass it down:
        powerBle: powerBle || "0x1F",
        minValue: t.minValue ?? null,
        maxValue: t.maxValue ?? null,
        ppmLimit: t.ppmLimit ?? 20,
        defaultMac,
      });
    } else {
      // LoRa / LTE (unchanged behavior)
      setRunDefaults({
        testName: nameForModal,
        type: t.type,
        freqHz:
          freqHz ||
          (tab === "LTE" ? 1_880_000_000 : 918_500_000), // your old defaults
        powerDbm: Number.isFinite(powerDbm)
          ? powerDbm
          : tab === "LTE"
          ? 23
          : 14,
        minValue: t.minValue ?? null,
        maxValue: t.maxValue ?? null,
        ppmLimit: t.ppmLimit ?? 20,
        defaultMac,
      });
    }

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

          {/* Builder body */}
          <div className="tsq-card-body">
            {sequences[tab].length === 0 ? (
              // Keep centered empty state without touching global CSS
              <div
                className="tsq-empty"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 220,
                  textAlign: "center",
                  width: "100%",
                }}
              >
                <div className="tsq-empty-icon">📥</div>
                <div className="tsq-empty-title">No tests yet</div>
                <div className="tsq-empty-sub">Drag a test from the right to get started</div>
              </div>
            ) : (
              sequences[tab].map((t) => {
                const isFA = isFreqAccuracy(t);
                return (
                  <div
                    key={t.id}
                    className={[
                      "tsq-card", // keep original border style
                      "tsq-test-card",
                      draggingCardId === t.id ? "is-dragging" : "",
                      dragOverCardId === t.id ? `is-over-${dragOverEdge}` : "",
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
                            onChange={(e) => {
                              const v = e.target.value;
                              setSequences((prev) => {
                                const copy = { ...prev };
                                copy[tab] = copy[tab].map((x) => (x.id === t.id ? { ...x, name: v } : x));
                                return copy;
                              });
                            }}
                            placeholder="e.g., Tx Power"
                          />
                        </div>

                        <div className="tsq-form-grid">
                          <div className="tsq-form-row">
                            <label>{tab === "LTE" ? "EARFCN / Frequency (MHz)" : "Frequency (MHz)"}</label>
                            <input
                              className="tsq-input"
                              value={t.frequencyText ?? ""}
                              onChange={(e) => updateTest(t.id, { frequencyText: e.target.value })}
                              placeholder="e.g., 918.5 or 918500000"
                            />
                          </div>
                        </div>

                        <div className="tsq-form-grid">
                          <div className="tsq-form-row">
                            <label>{tab === "BLE" ? "Power Parameter" : "Power (dBm)"}</label>
                            <input
                              className="tsq-input"
                              type={tab === "BLE" ? "text" : "number"}
                              value={tab === "BLE" ? (t.powerBle ?? "") : (t.powerText ?? "")}
                              placeholder={tab === "BLE" ? "e.g., 0x1F or 1F" : "e.g., 14"}
                              onChange={(e) =>
                                tab === "BLE"
                                  ? updateTest(t.id, { powerBle: e.target.value })
                                  : updateTest(t.id, { powerText: e.target.value })
                              }
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
                              <label>PPM Limit</label>
                              <input
                                className="tsq-input"
                                type="number"
                                value={t.ppmLimit ?? ""}
                                onChange={(e) =>
                                  updateTest(t.id, { ppmLimit: e.target.value === "" ? undefined : Number(e.target.value) })
                                }
                                placeholder="e.g., 20"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Library */}
        <aside className="tsq-card tsq-library">
          <div className="tsq-card-head">
            <div>
              <div className="tsq-card-title">Available Tests</div>
              <div className="tsq-card-sub">Drag tests to the {tab} builder</div>
            </div>
          </div>

          <div className="tsq-card-body">
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
        </aside>
      </div>

      {/* Run Modal */}
      {runOpen && runDefaults && (
        <RunModal
          open={true}
          onClose={() => setRunOpen(false)}
          protocol={tab as "LoRa" | "LTE" | "BLE"}
          mode={/frequency/i.test(runDefaults?.testName || "") ? "freqAccuracy" : "txPower"}
          testName={runDefaults?.testName}
          defaultFreqHz={runDefaults?.freqHz}
          defaultPowerDbm={runDefaults?.powerDbm}          // LoRa/LTE only
          defaultMac={runDefaults?.defaultMac || "80E1271FD8DD"}
          minValue={runDefaults?.minValue ?? null}
          maxValue={runDefaults?.maxValue ?? null}
          defaultPpmLimit={runDefaults?.ppmLimit ?? 20}
          bleDefaultPowerParamHex={
            tab === "BLE" ? (runDefaults?.powerBle || "0x1F") : undefined
          }
        />
      )}
    </div>
  );
}
