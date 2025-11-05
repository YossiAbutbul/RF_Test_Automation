// frontend/src/pages/TestSequence/index.tsx

import React, { useState, useRef, useEffect } from "react";
import { PageHeader } from "@/shared/components/ui/PageHeader";
import { Card } from "@/shared/components/ui/Card";
import RunModal from "@/features/test-execution/components/RunModal";
import {
  exportTestPlanToFile,
  importTestPlanFromFile,
  type PersistedSeq as FilePersistedSeq,
} from "@/features/test-sequences/utils/sequenceIO";
import { useSequencePersistence } from "@/features/test-sequences/hooks/useSequencePersistence";
import { useDragAndDrop } from "@/features/test-sequences/hooks/useDragAndDrop";
import {
  parseFirstFreqHz,
  parseFirstInt,
  isFreqAccuracy,
  isOBW,
  getDefaultFreqHz,
  getDefaultPowerDbm,
  findNextIdFromSequences,
} from "@/features/test-sequences/utils/sequenceHelpers";
import type {
  Protocol,
  TestItem,
  RunModalDefaults,
} from "@/features/test-sequences/types/sequence.types";

import BuilderHeader from "./components/BuilderHeader";
import EmptyState from "./components/EmptyState";
import FileDragOverlay from "./components/FileDragOverlay";
import TestCard from "./components/TestCard";
import TestLibrary from "./components/TestLibrary";
import "./TestSequence.css";

export default function TestSequence() {
  // State
  const [tab, setTab] = useState<Protocol>("LoRa");
  const [sequences, setSequences] = useState<Record<Protocol, TestItem[]>>({
    LoRa: [],
    LTE: [],
    BLE: [],
  });
  const nextId = useRef(1);

  // Hooks
  const { dragState, ...dragHandlers } = useDragAndDrop();

  // Hydrate from localStorage on mount
  const hydratedData = useSequencePersistence(tab, sequences, nextId.current);

  useEffect(() => {
    if (hydratedData) {
      setTab(hydratedData.tab);
      setSequences(hydratedData.sequences);
      nextId.current = hydratedData.nextId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedData]);

  // Test management
  const makeTest = (name: string): TestItem => ({
    id: nextId.current++,
    type: name,
    name,
    minimized: false,
  });

  const addTestToCurrent = (name: string) => {
    setSequences((prev) => {
      const minimizedList = prev[tab].map((t) => ({ ...t, minimized: true }));
      return { ...prev, [tab]: [...minimizedList, { ...makeTest(name), minimized: false }] };
    });
  };

  const updateTest = (id: number, patch: Partial<TestItem>) => {
    setSequences((prev) => ({
      ...prev,
      [tab]: prev[tab].map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  const removeTest = (id: number) => {
    setSequences((prev) => ({
      ...prev,
      [tab]: prev[tab].filter((t) => t.id !== id),
    }));
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

  const clearCurrentProtocol = () => {
    if (!sequences[tab].length) return;
    const ok = window.confirm(`Clear all ${tab} tests from the builder?`);
    if (!ok) return;
    setSequences((prev) => ({ ...prev, [tab]: [] }));
  };

  // Drag and drop handlers
  const onCardDrop = (e: React.DragEvent<HTMLDivElement>, id: number) => {
    e.preventDefault();
    const list = sequences[tab];
    const from = list.findIndex((t) => t.id === dragState.draggingCardId);
    const to = list.findIndex((t) => t.id === id);
    if (from === -1 || to === -1) return;
    const insertAt = to + (dragState.dragOverEdge === "below" ? 1 : 0);
    reorderInCurrent(from, insertAt);
    dragHandlers.onCardDragEnd();
  };

  const onBuilderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      dragHandlers.onFileDragEnter(e);
    }
  };

  const onBuilderDrop = async (e: React.DragEvent) => {
    e.preventDefault();

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      dragHandlers.clearFileDrag();
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
        console.log(`Loaded RF test plan from file saved at ${parsed.savedAtIso}`);
      } catch (err: any) {
        alert(err?.message || "Failed to load JSON file.");
      }
      return;
    }

    // Library drop
    if (dragState.draggingLibTest) {
      addTestToCurrent(dragState.draggingLibTest);
      dragHandlers.onLibraryDragEnd();
    }
  };

  // File I/O
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  // Run modal
  const [runOpen, setRunOpen] = useState(false);
  const [runDefaults, setRunDefaults] = useState<RunModalDefaults | null>(null);

  const playSingle = (t: TestItem) => {
    const mode = isOBW(t) ? "obw" : isFreqAccuracy(t) ? "freqAccuracy" : "txPower";
    const rawFreqHz = parseFirstFreqHz(t.frequencyText);
    const freqHz = rawFreqHz > 0 ? rawFreqHz : getDefaultFreqHz(tab);

    const defaults: RunModalDefaults = {
      testName: t.name,
      type: t.type,
      mode,
      freqHz,
    };

    if (mode === "txPower") {
      if (tab === "LoRa" || tab === "LTE") {
        const parsed = parseFirstInt(t.powerText);
        defaults.powerDbm =
          Number.isFinite(parsed) && parsed !== 0 ? parsed : getDefaultPowerDbm(tab);
      } else if (tab === "BLE") {
        defaults.powerBle = t.powerBle || "31";
      }
      defaults.minValue = t.minValue ?? null;
      defaults.maxValue = t.maxValue ?? null;
    } else if (mode === "freqAccuracy") {
      defaults.ppmLimit = t.ppmLimit || (tab === "BLE" ? 40 : 20);
    } else if (mode === "obw") {
      defaults.obwDataLength = t.obwDataLength || "1";
      defaults.obwPayloadPattern = t.obwPayloadPattern || "1";
      defaults.obwPhyType = t.obwPhyType || "2";
    }

    setRunDefaults(defaults);
    setRunOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Test Sequence"
        subtitle="Build and execute RF test sequences"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-4">
        {/* Builder */}
        <Card className="tsq-builder p-0">
          <BuilderHeader
            tab={tab}
            sequences={sequences}
            onTabChange={setTab}
            onClearCurrent={clearCurrentProtocol}
            onLoad={handleClickLoad}
            onSave={handleClickSave}
          />

          <FileDragOverlay active={dragState.fileDragActive} />

          <div
            className="px-1 tsq-card-body"
            onDragEnter={dragHandlers.onFileDragEnter}
            onDragOver={onBuilderDragOver}
            onDragLeave={dragHandlers.onFileDragLeave}
            onDrop={onBuilderDrop}
          >
            {sequences[tab].length === 0 ? (
              <EmptyState />
            ) : (
              sequences[tab].map((t) => (
                <TestCard
                  key={t.id}
                  test={t}
                  protocol={tab}
                  isDragging={dragState.draggingCardId === t.id}
                  isDragOver={dragState.dragOverCardId === t.id}
                  dragOverEdge={dragState.dragOverEdge}
                  onDragStart={dragHandlers.onCardDragStart}
                  onDragOver={dragHandlers.onCardDragOver}
                  onDrop={onCardDrop}
                  onDragEnd={dragHandlers.onCardDragEnd}
                  onToggleMinimize={toggleMinimize}
                  onRemove={removeTest}
                  onPlay={playSingle}
                  onUpdate={updateTest}
                />
              ))
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </Card>

        {/* Library */}
        <TestLibrary
          protocol={tab}
          onDragStart={dragHandlers.onLibraryDragStart}
          onDragEnd={dragHandlers.onLibraryDragEnd}
        />
      </div>

      {/* Run Modal */}
      {runDefaults && (
        <RunModal
          open={runOpen}
          onClose={() => setRunOpen(false)}
          protocol={tab}
          mode={runDefaults.mode}
          testName={runDefaults.testName}
          defaultFreqHz={runDefaults.freqHz}
          defaultPowerDbm={runDefaults.powerDbm}
          bleDefaultPowerParamHex={runDefaults.powerBle}
          minValue={runDefaults.minValue}
          maxValue={runDefaults.maxValue}
          defaultPpmLimit={runDefaults.ppmLimit}
          obwDataLength={runDefaults.obwDataLength}
          obwPayloadPattern={runDefaults.obwPayloadPattern}
          obwPhyType={runDefaults.obwPhyType}
        />
      )}
    </div>
  );
}