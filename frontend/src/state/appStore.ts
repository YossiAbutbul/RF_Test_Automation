// frontend/src/state/appStore.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/* ---------- Types ---------- */
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

type Sequences = {
  LoRa: TestItem[];
  LTE: TestItem[];
  BLE: TestItem[];
};

type TestSeqState = {
  tab: Protocol;
  sequences: Sequences;
};

type Actions = {
  setTab: (p: Protocol) => void;
  addTestToCurrent: (name: string) => void;
  updateTest: (id: number, patch: Partial<TestItem>) => void;
  removeTest: (id: number) => void;
  reorderInCurrent: (from: number, to: number) => void;
  clearCurrent: () => void;
};

type AppState = {
  testSeq: TestSeqState;
  actions: Actions;
};

/* ---------- Helpers ---------- */
let _nextId = 1;
const makeTest = (name: string): TestItem => ({
  id: _nextId++,
  type: name,
  name,
  minimized: false,
});

/* ---------- Store ---------- */
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      testSeq: {
        tab: "LoRa",
        sequences: { LoRa: [], LTE: [], BLE: [] },
      },
      actions: {
        setTab: (p) =>
          set((s) => ({ testSeq: { ...s.testSeq, tab: p } })),

        addTestToCurrent: (name) =>
          set((s) => {
            const tab = s.testSeq.tab;
            const seqs = { ...s.testSeq.sequences };
            seqs[tab] = [...seqs[tab], makeTest(name)];
            return { testSeq: { ...s.testSeq, sequences: seqs } };
          }),

        updateTest: (id, patch) =>
          set((s) => {
            const tab = s.testSeq.tab;
            const seqs = { ...s.testSeq.sequences };
            seqs[tab] = seqs[tab].map((t) => (t.id === id ? { ...t, ...patch } : t));
            return { testSeq: { ...s.testSeq, sequences: seqs } };
          }),

        removeTest: (id) =>
          set((s) => {
            const tab = s.testSeq.tab;
            const seqs = { ...s.testSeq.sequences };
            seqs[tab] = seqs[tab].filter((t) => t.id !== id);
            return { testSeq: { ...s.testSeq, sequences: seqs } };
          }),

        reorderInCurrent: (from, to) =>
          set((s) => {
            const tab = s.testSeq.tab;
            const list = [...s.testSeq.sequences[tab]];
            if (from < 0 || from >= list.length) return {};
            let insertAt = Math.max(0, Math.min(to, list.length));
            const [moved] = list.splice(from, 1);
            if (from < insertAt) insertAt -= 1;
            list.splice(insertAt, 0, moved);
            const seqs = { ...s.testSeq.sequences, [tab]: list };
            return { testSeq: { ...s.testSeq, sequences: seqs } };
          }),

        clearCurrent: () =>
          set((s) => {
            const tab = s.testSeq.tab;
            const seqs = { ...s.testSeq.sequences, [tab]: [] };
            return { testSeq: { ...s.testSeq, sequences: seqs } };
          }),
      },
    }),
    {
      name: "rf-automation-app", // localStorage key
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ testSeq: s.testSeq }), // persist only testSeq
    }
  )
);
