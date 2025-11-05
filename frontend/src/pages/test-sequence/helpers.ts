// src/pages/test-sequence/helpers.ts
import type { Protocol, TestItem } from "./types.ts";

export const TEST_LIBRARY = ["Tx Power", "Frequency Accuracy", "OBW"];

const NUM_RE = /[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i;

export const isFreqAccuracy = (t: TestItem) =>
  /frequency\s*accuracy/i.test(t.type);

export const isObw = (t: TestItem) => /^obw$/i.test(t.type);

export function parseFirstFreqHz(text?: string | number): number {
  if (text == null) return 0;
  const s = String(text);
  const m = s.match(NUM_RE);
  if (!m) return 0;
  const val = parseFloat(m[0]);
  return Number.isFinite(val)
    ? val < 1e6
      ? Math.round(val * 1_000_000)
      : Math.round(val)
    : 0;
}

export function parseFirstInt(text?: string | number): number {
  if (text == null) return 0;
  const s = String(text).split(",")[0].trim();
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

export function formatMHzLabel(hz: number): string {
  if (!hz || !Number.isFinite(hz)) return "";
  const mhz = hz / 1_000_000;
  const s = mhz.toFixed(3).replace(/\.?0+$/, "");
  return `${s}MHz`;
}

export function findNextIdFromSequences(seqs: Record<Protocol, TestItem[]>): number {
  const all = [...seqs.LoRa, ...seqs.LTE, ...seqs.BLE];
  const maxId = all.reduce((m, t) => (t.id > m ? t.id : m), 0);
  return maxId + 1;
}
