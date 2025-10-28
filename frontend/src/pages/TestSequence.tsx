import React from "react";
import { Trash2, FolderDown, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import "./css/TestSequence.css";
import RunModal from "../components/modals/RunModal";
import {
  exportTestPlanToFile,
  importTestPlanFromFile,
  type PersistedSeq as FilePersistedSeq,
} from "@/utils/sequenceIO";

// NOTE: include .ts/.tsx in relative imports for TS bundler/nodenext resolution
import { Protocol, TestItem, PersistedSeq } from "./test-sequence/types";
import {
  TEST_LIBRARY,
  isFreqAccuracy,
  parseFirstFreqHz,
  parseFirstInt,
  formatMHzLabel,
  findNextIdFromSequences,
} from "./test-sequence/helpers";
import ProtocolTabs from "./test-sequence/ProtocolTabs";
import BuilderHeaderActions from "./test-sequence/BuilderHeaderActions";
import LibraryPanel from "./test-sequence/LibraryPanel";
import TestCard from "./test-sequence/TestCard";

const SEQ_STORAGE_KEY = "rf-automation:test-sequence:v1";

export default function TestSequence() {
  // -------------------------------
  // State
  // -------------------------------
  const [tab, setTab] = React.useState<Protocol>("LoRa");
  const [sequences, setSequences] = React.useState<Record<Protocol, TestItem[]>>({
    LoRa: [],
    LTE: [],
    BLE: [],
  });
  const nextId = React.useRef(1);

  // DnD state (cards and library)
  const [draggingCardId, setDraggingCardId] = React.useState<number | null>(null);
  const [dragOverCardId, setDragOverCardId] = React.useState<number | null>(null);
  const [dragOverEdge, setDragOverEdge] = React.useState<"above" | "below" | null>(null);
  const [draggingLibTest, setDraggingLibTest] = React.useState<string | null>(null);

  // File-drop overlay
  const [fileDragActive, setFileDragActive] = React.useState(false);

  // Run Modal
  const [runOpen, setRunOpen] = React.useState(false);
  const [runDefaults, setRunDefaults] = React.useState<{
    testName: string;
    type: string;
    mode: "txPower" | "freqAccuracy";
    freqHz: number;
    powerDbm?: number;
    powerBle?: string;
    minValue?: number | null;
    maxValue?: number | null;
    ppmLimit?: number;
    defaultMac?: string | null;
  } | null>(null);

  // File input ref for "Load"
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // -------------------------------
  // Hydration + Persistence
  // -------------------------------
  const hydratedRef = React.useRef(false);

  React.useEffect(() => {
    if (hydratedRef.current) return;
    try {
      const raw = localStorage.getItem(SEQ_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedSeq;
        if (parsed?.sequences && parsed?.tab) {
          setTab(parsed.tab);
          setSequences(parsed.sequences);
          nextId.current = Number.isFinite(parsed.nextId)
            ? parsed.nextId
            : findNextIdFromSequences(parsed.sequences);
        }
      }
    } catch {}
    hydratedRef.current = true;
  }, []);

  const persistToLocal = (state: { tab: Protocol; sequences: Record<Protocol, TestItem[]>; nextId: number }) => {
    const payload: PersistedSeq = {
      tab: state.tab,
      sequences: state.sequences,
      nextId: state.nextId,
    };
    try {
      localStorage.setItem(SEQ_STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  };

  React.useEffect(() => {
    if (!hydratedRef.current) return;
    persistToLocal({ tab, sequences, nextId: nextId.current });
  }, [tab, sequences]);

  // -------------------------------
  // Mutators
  // -------------------------------
  const makeTest = (name: string): TestItem => ({
    id: nextId.current++,
    type: name,
    name,
    minimized: false,
  });

  const addTestToCurrent = (name: string) => {
    setSequences((prev) => {
      // minimize existing before adding (same UX)
      const minimizedList = prev[tab].map((t) => ({ ...t, minimized: true }));
      return { ...prev, [tab]: [...minimizedList, { ...makeTest(name), minimized: false }] };
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

  // -------------------------------
  // Clear
  // -------------------------------
  const clearCurrentProtocol = () => {
    if (!sequences[tab].length) return;
    const ok = window.confirm(`Clear all ${tab} tests from the builder?`);
    if (!ok) return;
    setSequences((prev) => ({ ...prev, [tab]: [] }));
  };

  // -------------------------------
  // Drag & Drop (cards)
  // -------------------------------
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

  // -------------------------------
  // Builder: file/library drop target
  // -------------------------------
  const onBuilderDragEnter = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) setFileDragActive(true);
  };

  const onBuilderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (Array.from(e.dataTransfer.types).includes("Files")) setFileDragActive(true);
  };

  const onBuilderDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDragActive(false);
  };

  const onBuilderDrop = async (e: React.DragEvent) => {
    e.preventDefault();

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setFileDragActive(false);
      const file = files[0];
      if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
        alert("Please drop a .json RF test plan file.");
        return;
      }
      try {
        const parsed = await importTestPlanFromFile(file);
        setTab(parsed.tab);
        setSequences(parsed.sequences);
        nextId.current = Number.isFinite(parsed.nextId)
          ? parsed.nextId
          : findNextIdFromSequences(parsed.sequences);
        persistToLocal({ tab: parsed.tab, sequences: parsed.sequences, nextId: nextId.current });
        console.log(`Loaded RF test plan from file saved at ${parsed.savedAtIso}`);
      } catch (err: any) {
        alert(err?.message || "Failed to load JSON file.");
      }
      return;
    }

    if (draggingLibTest) {
      addTestToCurrent(draggingLibTest);
      setDraggingLibTest(null);
    }
  };

  // -------------------------------
  // Load / Save buttons
  // -------------------------------
  const handleClickLoad = () => fileInputRef.current?.click();

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = await importTestPlanFromFile(file);
      setTab(parsed.tab);
      setSequences(parsed.sequences);
      nextId.current = Number.isFinite(parsed.nextId)
        ? parsed.nextId
        : findNextIdFromSequences(parsed.sequences);
      persistToLocal({ tab: parsed.tab, sequences: parsed.sequences, nextId: nextId.current });
      console.log(`Loaded RF test plan from file saved at ${parsed.savedAtIso}`);
    } catch (err: any) {
      alert(err?.message || "Failed to load JSON file.");
    }
  };

  const handleClickSave = () => {
    const payload: FilePersistedSeq = {
      version: 1,
      savedAtIso: new Date().toISOString(),
      tab,
      sequences,
      nextId: nextId.current,
    };
    exportTestPlanToFile(
      payload,
      `rf-test-plan_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`
    );
  };

  // -------------------------------
  // Run modal wiring
  // -------------------------------
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
    if (tab === "LTE") defaultMac = "80E1271FD8B8";

    const nameForModal =
      tab === "LTE" ? `LTE ${t.type || "Test"}` :
      tab === "LoRa" ? `LoRa ${t.type || "Test"}` :
      t.type || "Test";

    const tabPpmDefault = tab === "BLE" ? 40 : 20;

    const base = {
      testName: nameForModal,
      type: t.type,
      mode,
      freqHz,
      minValue: t.minValue ?? null,
      maxValue: t.maxValue ?? null,
      ppmLimit: t.ppmLimit ?? tabPpmDefault,
      defaultMac,
    };

    const payload = tab === "BLE" ? { ...base, powerBle } : { ...base, powerDbm };
    setRunDefaults(payload);
    setRunOpen(true);
  };

  // -------------------------------
  // Render
  // -------------------------------
  return (
    <div className="configurations-page">
      <PageHeader title="Test Sequence" subtitle="Define and run automated RF tests" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Builder (left, spans 2 cols) */}
        <Card className="p-0 lg:grid-cols-2 lg:col-span-2 tsq-card-like">
          <div
            className={[
              "tsq-builder",
              draggingLibTest ? "is-drop-target" : "",
              fileDragActive ? "is-file-drop" : "",
            ].join(" ")}
            onDragEnter={onBuilderDragEnter}
            onDragOver={onBuilderDragOver}
            onDragLeave={onBuilderDragLeave}
            onDrop={onBuilderDrop}
          >
            {/* Header */}
            <div className="tsq-card-head">
              <div className="tsq-head-left">
                <ProtocolTabs
                  tab={tab}
                  sequences={sequences}
                  onChange={setTab}
                />

                <div className="tsq-card-title mt-2">{tab} Builder</div>
                <div className="tsq-card-sub">
                  Drag tests from the library or drop a JSON plan to load
                </div>
              </div>

              <BuilderHeaderActions
                onClearCurrent={clearCurrentProtocol}
                onLoad={handleClickLoad}
                onSave={handleClickSave}
                fileInputRef={fileInputRef}
                onFileChange={handleFileChange}
                Icons={{ Trash2, FolderDown, Save }}
              />
            </div>

            {/* FILE DROP OVERLAY */}
            {fileDragActive && (
              <div className="tsq-file-overlay">
                <div className="tsq-file-overlay-inner">
                  <div className="tsq-file-icon">📄</div>
                  <div className="tsq-file-title">Drop RF Test Plan (.json) to Load</div>
                  <div className="tsq-file-sub">This will replace the current builder state for all protocols</div>
                </div>
              </div>
            )}

            {/* Body */}
            <div className="px-1 tsq-card-body">
              {sequences[tab].length === 0 ? (
                <div className="tsq-empty-wrap">
                  <div className="tsq-empty-icon">📥</div>
                  <div className="tsq-empty-title">No tests yet</div>
                  <div className="tsq-empty-sub">
                    Drag a test from the right or drop a plan JSON here
                  </div>
                </div>
              ) : (
                sequences[tab].map((t) => {
                  const isFA = isFreqAccuracy(t);
                  const hzFromInput = parseFirstFreqHz(t.frequencyText);
                  const hzDefault =
                    tab === "LTE" ? 1_880_000_000 :
                    tab === "LoRa" ? 918_500_000 :
                    2_402_000_000;
                  const headerHz = hzFromInput || hzDefault;
                  const headerFreqLabel = formatMHzLabel(headerHz);

                  let headerPowerLabel: string | null = null;
                  if (!isFA && (tab === "LoRa" || tab === "LTE")) {
                    const parsed = parseFirstInt(t.powerText);
                    const powerDbm =
                      Number.isFinite(parsed) && parsed !== 0
                        ? parsed
                        : tab === "LTE"
                        ? 23
                        : 14;
                    headerPowerLabel = `${powerDbm}dBm`;
                  }

                  return (
                    <TestCard
                      key={t.id}
                      t={t}
                      tab={tab}
                      headerFreqLabel={headerFreqLabel}
                      headerPowerLabel={headerPowerLabel}
                      draggingCardId={draggingCardId}
                      dragOverCardId={dragOverCardId}
                      dragOverEdge={dragOverEdge}
                      onDragStart={onCardDragStart}
                      onDragOver={onCardDragOver}
                      onDrop={onCardDrop}
                      onDragEnd={onCardDragEnd}
                      onToggle={() => toggleMinimize(t.id)}
                      onRun={() => playSingle(t)}
                      onRemove={() => removeTest(t.id)}
                      onUpdate={(patch) => updateTest(t.id, patch)}
                      isFrequencyAccuracy={isFA}
                    />
                  );
                })
              )}
            </div>
          </div>
        </Card>

        {/* Library (right column) */}
        <Card className="p-0 overflow-hidden tsq-card-like">
          <div className="tsq-card-head">
            <div>
              <div className="tsq-card-title">Available Tests</div>
              <div className="tsq-card-sub">Drag tests to the {tab} builder</div>
            </div>
          </div>
          <LibraryPanel
            tests={TEST_LIBRARY}
            onDragStart={(name) => setDraggingLibTest(name)}
            onQuickAdd={(name) => addTestToCurrent(name)}
          />
        </Card>
      </div>

      {/* Run Modal */}
      {runOpen && runDefaults && (
        <RunModal
          key={`${tab}-${runDefaults.type}-${runDefaults.mode}`}
          open={true}
          onClose={() => setRunOpen(false)}
          protocol={tab}
          mode={runDefaults.mode}
          testName={runDefaults.testName}
          defaultFreqHz={runDefaults.freqHz}
          defaultMac={runDefaults.defaultMac || "80E1271FD8B8"}
          minValue={runDefaults.minValue ?? null}
          maxValue={runDefaults.maxValue ?? null}
          defaultPpmLimit={runDefaults.ppmLimit ?? (tab === "BLE" ? 40 : 20)}
          {...(tab === "BLE"
            ? { bleDefaultPowerParamHex: runDefaults.powerBle || "31" }
            : { defaultPowerDbm: runDefaults.powerDbm ?? 14 })}
        />
      )}
    </div>
  );
}
