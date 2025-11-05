// frontend/src/features/test-sequences/utils/sequenceHelpers.ts

import type { Protocol, TestItem } from "../types/sequence.types";

const NUM_RE = /[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i;

/**
 * Parse frequency from text/number input
 * Handles MHz and Hz inputs
 */
export function parseFirstFreqHz(text?: string | number): number {
  if (text == null) return 0;
  const s = String(text);
  const m = s.match(NUM_RE);
  if (!m) return 0;
  const val = parseFloat(m[0]);
  return Number.isFinite(val)
    ? val < 1e6
      ? Math.round(val * 1_000_000) // Convert MHz to Hz
      : Math.round(val)
    : 0;
}

/**
 * Parse integer from text (handles comma-separated values)
 */
export function parseFirstInt(text?: string | number): number {
  if (text == null) return 0;
  const s = String(text).split(",")[0].trim();
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format Hz to MHz label for display
 */
export function formatMHzLabel(hz: number): string {
  if (!hz || !Number.isFinite(hz)) return "";
  const mhz = hz / 1_000_000;
  const s = mhz.toFixed(3).replace(/\.?0+$/, ""); // Remove trailing zeros
  return `${s}MHz`;
}

/**
 * Check if test is Frequency Accuracy type
 */
export function isFreqAccuracy(test: TestItem): boolean {
  return /frequency\s*accuracy/i.test(test.type);
}

/**
 * Check if test is OBW type
 */
export function isOBW(test: TestItem): boolean {
  return /obw|occupied\s*bandwidth/i.test(test.type);
}

/**
 * Find next available ID from sequences
 */
export function findNextIdFromSequences(
  seqs: Record<Protocol, TestItem[]>
): number {
  const all = [...seqs.LoRa, ...seqs.LTE, ...seqs.BLE];
  const maxId = all.reduce((m, t) => (t.id > m ? t.id : m), 0);
  return maxId + 1;
}

/**
 * Get default frequency for protocol
 */
export function getDefaultFreqHz(protocol: Protocol): number {
  switch (protocol) {
    case "LTE":
      return 1_880_000_000;
    case "LoRa":
      return 918_500_000;
    case "BLE":
      return 2_402_000_000;
    default:
      return 918_500_000;
  }
}

/**
 * Get default power for protocol
 */
export function getDefaultPowerDbm(protocol: Protocol): number {
  switch (protocol) {
    case "LTE":
      return 23;
    case "LoRa":
      return 14;
    case "BLE":
      return 0;
    default:
      return 14;
  }
}