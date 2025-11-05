// frontend/src/pages/TestSequence/components/ProtocolTabs.tsx

import type { Protocol } from "@/features/test-sequences/types/sequence.types";

interface ProtocolTabsProps {
  tab: Protocol;
  sequences: Record<Protocol, any[]>;
  onTabChange: (protocol: Protocol) => void;
}

const PROTOCOLS: Protocol[] = ["LoRa", "LTE", "BLE"];

export default function ProtocolTabs({ tab, sequences, onTabChange }: ProtocolTabsProps) {
  return (
    <div className="proto-tabs">
      {PROTOCOLS.map((p) => {
        const count = sequences[p]?.length || 0;
        return (
          <button
            key={p}
            className={`proto-pill ${tab === p ? "is-active" : ""}`}
            onClick={() => onTabChange(p)}
          >
            <span className="proto-label">{p}</span>
            <span className="proto-badge">{count}</span>
          </button>
        );
      })}
    </div>
  );
}