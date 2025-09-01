import { useMemo, useRef, useState } from "react";
import "./css/TestSequence.css";
import {
  PlayCircle,
  Trash2,
  GripVertical,
  ChevronDown,
  Plus,
} from "lucide-react";

type Protocol = "LoRa" | "LTE" | "BLE";
type TestType =
  | "TX Power"
  | "Frequency Accuracy"
  | "OBW"
  | "TX Current Consumption"
  | "Spurious Emissions";

type TestInstance = {
  id: string;
  type: TestType;
  minimized: boolean;
  name: string;
  runCondition: "Run Always" | "Run If Pass" | "Run If Fail";
  frequencyMHz: number[];
  powerLevels: string;
  minValue?: number;
  maxValue?: number;
  includeScreenshot?: boolean;
};

const TEST_LIBRARY: TestType[] = [
  "TX Power",
  "Frequency Accuracy",
  "OBW",
  "TX Current Consumption",
  "Spurious Emissions",
];

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function TestSequence() {
  const [tab, setTab] = useState<Protocol>("LoRa");

  // protocol-scoped sequences
  const [sequences, setSequences] = useState<Record<Protocol, TestInstance[]>>({
    LoRa: [],
    LTE: [],
    BLE: [],
  });

  // dragging from library → builder
  const [draggingLibTest, setDraggingLibTest] = useState<TestType | null>(null);

  // reordering inside builder
  type OverEdge = "before" | "after";
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [dragOverEdge, setDragOverEdge] = useState<OverEdge | null>(null);
  const overCardId = useRef<string | null>(null);

  const totalByProtocol = useMemo(
    () => ({
      LoRa: sequences.LoRa.length,
      LTE: sequences.LTE.length,
      BLE: sequences.BLE.length,
    }),
    [sequences]
  );
  const totalAll =
    totalByProtocol.LoRa + totalByProtocol.LTE + totalByProtocol.BLE;

  function addTestToCurrent(t: TestType) {
    setSequences((prev) => {
      const current = prev[tab];

      // minimize all existing open cards
      const minimized = current.map((c) => ({ ...c, minimized: true }));

      const newTest: TestInstance = {
        id: makeId(),
        type: t,
        minimized: false, // newest stays open
        name: t,
        runCondition: "Run Always",
        frequencyMHz: [918.5],
        powerLevels: "14dBm",
        minValue: 13,
        maxValue: 15,
        includeScreenshot: false,
      };

      return { ...prev, [tab]: [...minimized, newTest] };
    });
  }

  // ===== Library → Builder DnD =====
  function onLibDragStart(t: TestType) {
    setDraggingLibTest(t);
  }
  function onBuilderDragOver(e: React.DragEvent) {
    // allow drop from library
    if (draggingLibTest) e.preventDefault();
  }
  function onBuilderDrop(e: React.DragEvent) {
    if (draggingLibTest) {
      e.preventDefault();
      addTestToCurrent(draggingLibTest);
      setDraggingLibTest(null);
    }
  }

  // ===== Modern ghost for reordering cursor =====
  function setCustomDragImage(e: React.DragEvent, label: string) {
    const g = document.createElement("div");
    g.style.cssText = `
      position:fixed; top:0; left:0; z-index:9999;
      pointer-events:none; padding:8px 12px; border-radius:12px;
      background:#111827; color:white; font:500 12px system-ui;
      box-shadow:0 8px 22px rgba(17,24,39,.28); opacity:.95;
    `;
    g.textContent = label;
    document.body.appendChild(g);
    e.dataTransfer.setDragImage(g, 12, 12);
    setTimeout(() => g.remove(), 0);
  }

  // ===== Reorder inside builder (native HTML5 DnD) =====
  function onCardDragStart(e: React.DragEvent, id: string, label: string) {
    setDraggingCardId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setCustomDragImage(e, label);
  }

  function onCardDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (!draggingCardId || draggingCardId === id) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge: OverEdge =
      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDragOverCardId(id);
    setDragOverEdge(edge);
    overCardId.current = id;
  }

  function onCardDrop(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (!draggingCardId || !dragOverEdge) return;

    setSequences((prev) => {
      const list = [...prev[tab]];
      const from = list.findIndex((x) => x.id === draggingCardId);
      const to = list.findIndex((x) => x.id === id);
      if (from === -1 || to === -1) return prev;

      const [moved] = list.splice(from, 1);

      // if dropping "after" and original index was before target, account for shift
      const insertIndex =
        dragOverEdge === "before" ? (from < to ? to - 0 : to) : from < to ? to : to + 1;

      list.splice(insertIndex, 0, moved);
      return { ...prev, [tab]: list };
    });

    setDraggingCardId(null);
    setDragOverCardId(null);
    setDragOverEdge(null);
    overCardId.current = null;
  }

  function onCardDragEnd() {
    setDraggingCardId(null);
    setDragOverCardId(null);
    setDragOverEdge(null);
    overCardId.current = null;
  }

  function toggleMinimize(testId: string) {
    setSequences((prev) => {
      const list = prev[tab].map((t) =>
        t.id === testId ? { ...t, minimized: !t.minimized } : t
      );
      return { ...prev, [tab]: list };
    });
  }

  function playSingle(testId: string) {
    const t = sequences[tab].find((x) => x.id === testId);
    if (!t) return;
    // TODO: wire to FastAPI (POST) if you want real execution here.
    console.log("[PLAY SINGLE TEST]", { protocol: tab, test: t });
    alert(`Playing "${t.type}" locally on ${tab}`);
  }

  function removeTest(testId: string) {
    setSequences((prev) => ({
      ...prev,
      [tab]: prev[tab].filter((t) => t.id !== testId),
    }));
  }

  // helper to compose badge class
  function badgeClass(p: Protocol) {
    switch (p) {
      case "LoRa":
        return "tsq-badge tsq-badge-lora" + (totalByProtocol[p] ? " has-count" : "");
      case "LTE":
        return "tsq-badge tsq-badge-lte" + (totalByProtocol[p] ? " has-count" : "");
      case "BLE":
        return "tsq-badge tsq-badge-ble" + (totalByProtocol[p] ? " has-count" : "");
    }
  }

  return (
    <div className="tsq-container">
      <div className="tsq-header">
        <div>
          <div className="tsq-title">Test Sequence</div>
          <div className="tsq-subtitle">
            Define and control your automated test workflows
          </div>
        </div>
        <div className="tsq-total">Total Tests: {totalAll}</div>
      </div>

      {/* Tabs with colored count bubbles */}
      <div className="tsq-tabs">
        {(["LoRa", "LTE", "BLE"] as const).map((p) => (
          <button
            key={p}
            className={`tsq-tab ${tab === p ? "is-active" : ""}`}
            onClick={() => setTab(p)}
          >
            {p}
            <span className={badgeClass(p)}>{totalByProtocol[p]}</span>
          </button>
        ))}
      </div>

      <div className="tsq-grid">
        {/* Builder */}
        <section
          className={`tsq-card tsq-builder ${
            draggingLibTest ? "is-drop-target" : ""
          }`}
          onDragOver={onBuilderDragOver}
          onDrop={onBuilderDrop}
        >
          <div className="tsq-card-head">
            <div>
              <div className="tsq-card-title">
                {tab.toUpperCase()} Test Procedure Builder
              </div>
              <div className="tsq-card-sub">
                Drag tests from the library or reorder existing tests
              </div>
            </div>
            <div className="tsq-actions">
              <button className="tsq-btn ghost">Load {tab.toUpperCase()}</button>
              <button className="tsq-btn primary">Save {tab.toUpperCase()}</button>
            </div>
          </div>

          {sequences[tab].length === 0 ? (
            <div className="tsq-dropzone">
              No {tab.toUpperCase()} tests added yet
              <br />
              Drag tests from the library to get started
            </div>
          ) : (
            <div className="tsq-tests">
              {sequences[tab].map((t) => (
                <article
                  key={t.id}
                  className={[
                    "tsq-test",
                    t.minimized ? "is-min" : "",
                    draggingCardId === t.id ? "is-dragging" : "",
                    dragOverCardId === t.id && dragOverEdge ? `is-over is-${dragOverEdge}` : "",
                  ].join(" ")}
                  draggable
                  onDragStart={(e) => onCardDragStart(e, t.id, `${t.type} · ${tab}`)}
                  onDragOver={(e) => onCardDragOver(e, t.id)}
                  onDrop={(e) => onCardDrop(e, t.id)}
                  onDragEnd={onCardDragEnd}
                >
                  <header className="tsq-test-head">
                    <div className="tsq-test-title">
                      <span className="tsq-test-drag-handle" title="Drag to reorder">
                        <GripVertical size={16} />
                      </span>

                      {/* Title + inline minimize toggle */}
                      <button
                        className="tsq-title-toggle"
                        onClick={() => toggleMinimize(t.id)}
                        title={t.minimized ? "Expand" : "Minimize"}
                      >
                        <span className="tsq-title-text">
                          {t.type} <span className="tsq-test-proto">· {tab}</span>
                        </span>
                        <ChevronDown
                          size={16}
                          className={`tsq-title-caret ${t.minimized ? "" : "is-open"}`}
                        />
                      </button>
                    </div>

                    {/* Actions (now borderless icons) */}
                    <div className="tsq-test-actions">
                      <button
                        className="tsq-icon-btn ghost"
                        title="Play locally"
                        onClick={() => playSingle(t.id)}
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
                        <input className="tsq-input" defaultValue={t.name} />
                      </div>

                      <div className="tsq-form-grid">
                        <div className="tsq-form-row">
                          <label>Run Condition</label>
                          <select
                            className="tsq-input"
                            defaultValue={t.runCondition}
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
                            defaultValue={`${t.frequencyMHz.join(", ")} MHz`}
                          />
                        </div>
                      </div>

                      <div className="tsq-form-grid">
                        <div className="tsq-form-row">
                          <label>Power Level</label>
                          <input
                            className="tsq-input"
                            defaultValue={t.powerLevels}
                          />
                        </div>
                        <div className="tsq-form-row">
                          <label>Min Value</label>
                          <input
                            className="tsq-input"
                            type="number"
                            defaultValue={t.minValue ?? 0}
                          />
                        </div>
                        <div className="tsq-form-row">
                          <label>Max Value</label>
                          <input
                            className="tsq-input"
                            type="number"
                            defaultValue={t.maxValue ?? 100}
                          />
                        </div>
                      </div>

                      <label className="tsq-check">
                        <input
                          type="checkbox"
                          defaultChecked={t.includeScreenshot}
                        />{" "}
                        Include Spectrum Screenshot
                      </label>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Library */}
        <aside className="tsq-card tsq-library">
          <div className="tsq-card-head">
            <div className="tsq-card-title">Available Tests</div>
            <button className="tsq-btn ghost">
              <Plus className="mr-1" size={16} /> Add
            </button>
          </div>
          <div className="tsq-card-sub">
            Drag tests to the {tab.toUpperCase()} procedure builder
          </div>

          <div className="tsq-library-list">
            {TEST_LIBRARY.map((name) => (
              <div
                key={name}
                className="tsq-lib-item"
                draggable
                onDragStart={() => onLibDragStart(name)}
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

          <div className="tsq-quick">
            <div className="tsq-quick-title">Quick Actions</div>
            <div className="tsq-quick-grid">
              <button className="tsq-btn">Load Template</button>
              <button className="tsq-btn">Save as Template</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
