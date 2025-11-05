// frontend/src/features/test-sequences/hooks/useSequencePersistence.ts

import { useEffect, useRef, useState } from "react";
import type { Protocol, TestItem, PersistedSeq } from "../types/sequence.types";
import { findNextIdFromSequences } from "../utils/sequenceHelpers";

const SEQ_STORAGE_KEY = "rf-automation:test-sequence:v1";

interface HydratedData {
  tab: Protocol;
  sequences: Record<Protocol, TestItem[]>;
  nextId: number;
}

/**
 * Hook to manage persistence of test sequences to localStorage
 * Returns hydrated data on mount, and auto-saves on changes
 */
export function useSequencePersistence(
  tab: Protocol,
  sequences: Record<Protocol, TestItem[]>,
  nextId: number
): HydratedData | null {
  const [hydratedData, setHydratedData] = useState<HydratedData | null>(null);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage ONCE on mount
  useEffect(() => {
    if (hydratedRef.current) return;

    try {
      const raw = localStorage.getItem(SEQ_STORAGE_KEY);
      if (raw) {
        const parsed: PersistedSeq = JSON.parse(raw);
        setHydratedData({
          tab: parsed.tab || "LoRa",
          sequences: parsed.sequences || { LoRa: [], LTE: [], BLE: [] },
          nextId: Number.isFinite(parsed.nextId)
            ? parsed.nextId
            : findNextIdFromSequences(
                parsed.sequences || { LoRa: [], LTE: [], BLE: [] }
              ),
        });
      }
    } catch {
      // Ignore errors
    }

    hydratedRef.current = true;
  }, []); // Empty deps - only run once

  // Persist to localStorage when data changes
  useEffect(() => {
    if (!hydratedRef.current) return; // Don't persist before hydration

    const payload: PersistedSeq = {
      tab,
      sequences,
      nextId,
    };

    try {
      localStorage.setItem(SEQ_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore errors
    }
  }, [tab, sequences, nextId]);

  return hydratedData;
}