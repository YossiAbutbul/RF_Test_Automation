import React from "react";
import { ChevronDown, GripVertical, Trash2, PlayCircle } from "lucide-react";
import "./css/TestSequence.css";
import RunModal from "../components/modals/RunModal"; // ← added

// -------------------------------
// Types (match your existing usage)
// -------------------------------
export type Protocol = "LoRa" | "LTE" | "BLE";

export type TestItem = {
  id: number;
  type: string;          // e.g., "Tx Power", "Frequency Accuracy"
  name: string;          // editable display name
  minimized?: boolean;

  // free-form inputs from the card
  frequencyText?: string; // user-entered freq; we won't parse here
  powerText?: string;     // for LoRa/LTE
  powerBle?: string;      // for BLE
  minValue?: number;
  maxValue?: number;
  ppmLimit?: number;
};

// -------------------------------
// Persistence helpers (tiny + safe)
// -------------------------------
const SEQ_STORAGE_KEY = "rf-automation:test-sequence:v1";

type PersistedSeq = {
  tab: Protocol;
  sequences: Record<Protocol, TestItem[]>;
  nextId: number;
};

function findNextIdFromSequences(seqs: Record<Protocol, TestItem[]>): number {
  const all = [...seqs.LoRa, ...seqs.LTE, ...seqs.BLE];
  const maxId = all.reduce((m, t) => (t.id > m ? t.id : m), 0);
  return maxId + 1;
}

// -------------------------------
// Small helpers for Run defaults
// -------------------------------
const NUM_RE = /[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i;

function parseFirstFreqHz(text?: string | number): number {
  if (text == null) return 0;
  const s = String(text);
  const m = s.match(NUM_RE);
  if (!m) return 0;
  const val = parseFloat(m[0]);
  // Treat < 1e6 as MHz; otherwise assume already Hz
  return Number.isFinite(val) ? (val < 1e6 ? Math.round(val * 1_000_000) : Math.round(val)) : 0;
}

function parseFirstInt(text?: string | number): number {
  if (text == null) return 0;
  const s = String(text).split(",")[0].trim();
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

const isFreqAccuracy = (t: TestItem) => /frequency\s*accuracy/i.test(t.type);

// -------------------------------------------------------
// Component (your logic/structure/styles preserved)
// -------------------------------------------------------
const TEST_LIBRARY = ["Tx Power", "Frequency Accuracy"];

export default function TestSequence() {
  // your state
  const [tab, setTab] = React.useState<Protocol>("LoRa");
  const [sequences, setSequences] = React.useState<Record<Protocol, TestItem[]>>({
    LoRa: [],
    LTE: [],
    BLE: [],
  });
  const nextId = React.useRef(1);

  // ------- Hydration & Persist (added earlier) -------
  const hydratedRef = React.useRef(false);

  React.useEffect(() => {
    if (hydratedRef.current) return;
    try {
      const raw = localStorage.getItem(SEQ_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedSeq;
        if (parsed && parsed.sequences && parsed.tab) {
          setTab(parsed.tab);
          setSequences(parsed.sequences);
          nextId.current = Number.isFinite(parsed.nextId)
            ? parsed.nextId
            : findNextIdFromSequences(parsed.sequences);
        }
      }
    } catch {
      // ignore malformed cache
    } finally {
      hydratedRef.current = true;
    }
  }, []);

  React.useEffect(() => {
    if (!hydratedRef.current) return;
    const payload: PersistedSeq = {
      tab,
      sequences,
      nextId: nextId.current,
    };
    try {
      localStorage.setItem(SEQ_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // storage may be full/blocked; ignore
    }
  }, [tab, sequences]);
  // ------- /Hydration & Persist -------

  // your DnD UI state
  const [draggingCardId, setDraggingCardId] = React.useState<number | null>(null);
  const [dragOverCardId, setDragOverCardId] = React.useState<number | null>(null);
  const [dragOverEdge, setDragOverEdge] = React.useState<"above" | "below" | null>(null);
  const [draggingLibTest, setDraggingLibTest] = React.useState<string | null>(null);

  const totalAll =
    sequences.LoRa.length + sequences.LTE.length + sequences.BLE.length;

  // your helpers
  const makeTest = (name: string): TestItem => ({
    id: nextId.current++,
    type: name,
    name,
    minimized: false,
  });

  const addTestToCurrent = (name: string) => {
    setSequences((prev) => {
      // create new test
      const newTest = makeTest(name);
      // minimize all existing tests in the current tab
      const minimizedList = prev[tab].map((t) => ({ ...t, minimized: true }));
      // add new test expanded
      return { ...prev, [tab]: [...minimizedList, { ...newTest, minimized: false }] };
    });
  };

  const updateTest = (id: number, patch: Partial<TestItem>) => {
    setSequences((prev) => {
      const list = prev[tab].map((t) => (t.id === id ? { ...t, ...patch } : t));
      return { ...prev, [tab]: list };
    });
  };

  const removeTest = (id: number) => {
    setSequences((prev) => {
      const list = prev[tab].filter((t) => t.id !== id);
      return { ...prev, [tab]: list };
    });
  };

  const reorderInCurrent = (from: number, to: number) => {
    setSequences((prev) => {
      const list = [...prev[tab]];
      if (from < 0 || from >= list.length) return prev;
      let insertAt = Math.max(0, Math.min(to, list.length));
      const [moved] = list.splice(from, 1);
      if (from < insertAt) insertAt -= 1;
      list.splice(insertAt, 0, moved);
      return { ...prev, [tab]: list };
    });
  };

  const toggleMinimize = (id: number) => {
    const t = sequences[tab].find((x) => x.id === id);
    if (!t) return;
    updateTest(id, { minimized: !t.minimized });
  };

  // DnD: cards
  const onCardDragStart = (_: React.DragEvent<HTMLDivElement>, id: number) =>
    setDraggingCardId(id);

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
    const list = sequences[tab];
    const from = list.findIndex((t) => t.id === draggingCardId);
    const to = list.findIndex((t) => t.id === id);
    if (from === -1 || to === -1) return;
    const insertAt = to + (dragOverEdge === "below" ? 1 : 0);
    reorderInCurrent(from, insertAt);
    setDraggingCardId(null);
    setDragOverCardId(null);
    setDragOverEdge(null);
  };

  const onCardDragEnd = () => {
    setDraggingCardId(null);
    setDragOverCardId(null);
    setDragOverEdge(null);
  };

  // DnD: library → builder
  const onBuilderDragOver = (e: React.DragEvent) => e.preventDefault();
  const onBuilderDrop = () => {
    if (!draggingLibTest) return;
    addTestToCurrent(draggingLibTest);
    setDraggingLibTest(null);
  };

  // -----------------------------
  // Run modal wiring (restored)
  // -----------------------------
  const [runOpen, setRunOpen] = React.useState(false);
  const [runDefaults, setRunDefaults] = React.useState<{
    testName: string;
    type: string;
    mode: "txPower" | "freqAccuracy";
    freqHz: number;
    powerDbm?: number;  // LoRa/LTE
    powerBle?: string;  // BLE hex
    minValue?: number | null;
    maxValue?: number | null;
    ppmLimit?: number;
    defaultMac?: string | null;
  } | null>(null);

  const playSingle = (t: TestItem) => {
    const mode: "txPower" | "freqAccuracy" = isFreqAccuracy(t) ? "freqAccuracy" : "txPower";

    const rawFreqHz = parseFirstFreqHz(t.frequencyText);
    const freqHz =
      rawFreqHz > 0
        ? rawFreqHz
        : tab === "LTE"
        ? 1_880_000_000
        : tab === "LoRa"
        ? 918_500_000
        : 2_402_000_000;

    const powerDbmParsed = parseFirstInt(t.powerText);
    const powerDbm =
      Number.isFinite(powerDbmParsed) && powerDbmParsed !== 0
        ? powerDbmParsed
        : tab === "LTE"
        ? 23
        : 14;

    const powerBle = (t.powerBle || "").trim() || "31";

    let defaultMac: string | null = null;
    if (tab === "LTE") defaultMac = "80E1271FD8DD";

    const nameForModal =
      tab === "LTE" ? `LTE ${t.type || "Test"}` :
      tab === "LoRa" ? `LoRa ${t.type || "Test"}` :
      t.type || "Test";

    // --- tab-based PPM default: 20 for LoRa/LTE, 40 for BLE ---
    const tabPpmDefault = tab === "BLE" ? 40 : 20;

    const base = {
      testName: nameForModal,
      type: t.type,
      mode,
      freqHz,
      minValue: t.minValue ?? null,
      maxValue: t.maxValue ?? null,
      ppmLimit: t.ppmLimit ?? tabPpmDefault, // ← modal gets the value from card, fallback by tab
      defaultMac,
    };

    const payload = tab === "BLE" ? { ...base, powerBle } : { ...base, powerDbm };

    setRunDefaults(payload);
    setRunOpen(true);
  };

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
          <button
            key={p}
            className={`tsq-tab ${tab === p ? "is-active" : ""}`}
            onClick={() => setTab(p)}
          >
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
              <div className="tsq-card-sub">
                Drag tests from the library or reorder existing tests
              </div>
            </div>
            <div className="tsq-actions">
              <button className="tsq-btn ghost">Load {tab.toUpperCase()}</button>
              <button className="tsq-btn primary">Save {tab.toUpperCase()}</button>
            </div>
          </div>

          <div className="tsq-card-body">
            {sequences[tab].length === 0 ? (
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
                <div className="tsq-empty-sub">
                  Drag a test from the right to get started
                </div>
              </div>
            ) : (
              sequences[tab].map((t) => {
                const isFA = /frequency\s*accuracy/i.test(t.type);
                // tab-based PPM default used in the card when value is undefined
                const tabPpmDefault = tab === "BLE" ? 40 : 20;

                return (
                  <div
                    key={t.id}
                    className={[
                      "tsq-card",
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
                            {t.type} <span className="tsq-test-proto">&nbsp;· {tab}</span>
                          </span>
                          <ChevronDown
                            size={16}
                            className={`tsq-title-caret ${t.minimized ? "" : "is-open"}`}
                          />
                        </button>
                      </div>

                      <div className="tsq-test-actions">
                        <button
                          className="tsq-icon-btn ghost"
                          title="Play locally"
                          onClick={() => playSingle(t)}
                        >
                          <PlayCircle size={18} />
                        </button>
                        <button
                          className="tsq-icon-btn ghost danger"
                          title="Remove"
                          onClick={() => removeTest(t.id)}
                        >
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
                            placeholder="e.g., Tx Power"
                          />
                        </div>

                        <div className="tsq-form-grid">
                          <div className="tsq-form-row">
                            <label>{tab === "LTE" ? "Frequency [MHz]" : "Frequency [MHz]"}</label>
                            <input
                              className="tsq-input"
                              value={
                                (t.frequencyText ?? "").trim() !== ""
                                  ? t.frequencyText
                                  : tab === "LoRa"
                                  ? "918.5"
                                  : tab === "LTE"
                                  ? "1880"
                                  : "2402"
                              }
                              onChange={(e) => updateTest(t.id, { frequencyText: e.target.value })}
                              placeholder={tab === "LoRa" ? "e.g., 918.5" : tab === "LTE" ? "e.g., 1880" : "e.g., 2402"}
                            />
                          </div>
                        </div>

                        <div className="tsq-form-grid">
                          <div className="tsq-form-row">
                            <label>{tab === "BLE" ? "Power Parameter" : "Power [dBm]"}</label>
                            <input
                              className="tsq-input"
                              type={tab === "BLE" ? "text" : "number"}
                              value={
                                tab === "BLE"
                                  ? (t.powerBle ?? "31")
                                  : tab === "LTE"
                                  ? (t.powerText ?? "23")
                                  : (t.powerText ?? "14")
                              }
                              placeholder={tab === "BLE" ? "e.g., 31" : tab === "LTE" ? "e.g., 23" : "e.g., 14"}
                              onChange={(e) =>
                                tab === "BLE"
                                  ? updateTest(t.id, { powerBle: e.target.value })
                                  : updateTest(t.id, { powerText: e.target.value })
                              }
                            />
                          </div>

                          {!isFA ? (
                            <>
                              <div className="tsq-form-row">
                                <label>Min Value [dBm]</label>
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
                                <label>Max Value [dBm]</label>
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
                                // Show the tab-based default (20 LoRa/LTE, 40 BLE) when empty
                                value={t.ppmLimit ?? tabPpmDefault}
                                onChange={(e) =>
                                  updateTest(t.id, {
                                    ppmLimit: e.target.value === "" ? undefined : Number(e.target.value),
                                  })
                                }
                                placeholder={String(tabPpmDefault)}
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
                <button
                  className="tsq-icon-btn"
                  onClick={() => addTestToCurrent(name)}
                  title="Quick Add"
                >
                  +
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Run Modal (restored) */}
      {runOpen && runDefaults && (
        <RunModal
          key={`${tab}-${runDefaults.type}-${runDefaults.mode}`}
          open={true}
          onClose={() => setRunOpen(false)}
          protocol={tab}
          mode={runDefaults.mode}
          testName={runDefaults.testName}
          defaultFreqHz={runDefaults.freqHz}
          defaultMac={runDefaults.defaultMac || "80E1271FD8DD"}
          minValue={runDefaults.minValue ?? null}
          maxValue={runDefaults.maxValue ?? null}
          // Ensure modal receives the value from the card (or tab default)
          defaultPpmLimit={runDefaults.ppmLimit ?? (tab === "BLE" ? 40 : 20)}
          {...(tab === "BLE"
            ? { bleDefaultPowerParamHex: runDefaults.powerBle || "31" }
            : { defaultPowerDbm: runDefaults.powerDbm ?? 14 })}
        />
      )}
    </div>
  );
}
