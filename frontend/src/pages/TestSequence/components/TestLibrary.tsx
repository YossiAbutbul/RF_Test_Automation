// frontend/src/pages/TestSequence/components/TestLibrary.tsx

import type { Protocol } from "@/features/test-sequences/types/sequence.types";

interface TestLibraryProps {
  protocol: Protocol;
  onDragStart: (testName: string) => void;
  onDragEnd: () => void;
}

const TEST_LIBRARY: Record<Protocol, string[]> = {
  LoRa: ["Tx Power", "Frequency Accuracy", "OBW"],
  LTE: ["Tx Power", "Frequency Accuracy", "OBW"],
  BLE: ["Tx Power", "Frequency Accuracy", "OBW"],
};

export default function TestLibrary({ protocol, onDragStart, onDragEnd }: TestLibraryProps) {
  const tests = TEST_LIBRARY[protocol] || [];

  return (
    <div className="tsq-library tsq-card-like">
      <div className="p-4">
        <div className="tsq-card-title">Test Library</div>
        <div className="tsq-card-sub">Drag tests to add them</div>
      </div>

      <div className="tsq-library-scroll">
        {tests.map((testName) => (
          <div
            key={testName}
            className="tsq-lib-item"
            draggable
            onDragStart={() => onDragStart(testName)}
            onDragEnd={onDragEnd}
          >
            <div>
              <div className="tsq-lib-name">{testName}</div>
              <div className="tsq-lib-sub">{protocol} test</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}