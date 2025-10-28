import React from "react";
import type { Protocol, TestItem } from "./types.ts";

type Props = {
  tab: Protocol;
  sequences: Record<Protocol, TestItem[]>;
  onChange: (p: Protocol) => void;
};

export default function ProtocolTabs({ tab, sequences, onChange }: Props) {
  return (
    <div className="proto-tabs" role="tablist" aria-label="Protocol">
      {(["LoRa", "LTE", "BLE"] as const).map((p) => {
        const isActive = tab === p;
        const count = sequences[p].length;
        return (
          <button
            key={p}
            role="tab"
            aria-selected={isActive}
            className={`proto-pill ${isActive ? "is-active" : ""}`}
            onClick={() => onChange(p)}
          >
            <span className="proto-label">{p}</span>
            <span className="proto-badge">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
