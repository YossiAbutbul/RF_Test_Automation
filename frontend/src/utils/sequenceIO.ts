// frontend/src/utils/sequenceIO.ts
export type Protocol = "LoRa" | "LTE" | "BLE";

export type TestItem = {
  id: number;
  type: string;
  name: string;
  minimized?: boolean;
  frequencyText?: string;
  powerText?: string;
  powerBle?: string;
  minValue?: number;
  maxValue?: number;
  ppmLimit?: number;
};

export type PersistedSeq = {
  version: 1;
  savedAtIso: string;
  tab: Protocol;
  sequences: Record<Protocol, TestItem[]>;
  nextId: number;
};

export function downloadBlob(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportTestPlanToFile(
  payload: PersistedSeq,
  filename?: string
) {
  const pretty = JSON.stringify(payload, null, 2);
  const defaultName =
    filename ||
    `rf-test-plan_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;

  const blob = new Blob([pretty], { type: "application/json" });

  // Try the File System Access API (Chrome/Edge) to open the OS "Save As" dialog.
  // Safari/Firefox will hit the fallback and use a normal download.
  const w: any = window as any;
  if (typeof w.showSaveFilePicker === "function") {
    (async () => {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName: defaultName,
          types: [
            {
              description: "RF Test Plan (JSON)",
              accept: { "application/json": [".json"] },
            },
          ],
          excludeAcceptAllOption: false,
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } catch (e: any) {
        // If user cancels, do nothing; on other errors, fall back.
        if (e?.name !== "AbortError") {
          downloadBlob(blob, defaultName);
        }
      }
    })();
    return;
  }

  // Fallback: regular download (will land in the browser's default downloads folder)
  downloadBlob(blob, defaultName);
}

export async function importTestPlanFromFile(
  file: File
): Promise<PersistedSeq> {
  const text = await file.text();
  const parsed = JSON.parse(text);

  if (
    !parsed ||
    parsed.version !== 1 ||
    !parsed.sequences ||
    !parsed.tab ||
    typeof parsed.nextId !== "number"
  ) {
    throw new Error("Invalid RF test plan JSON structure.");
  }

  const hasAllProtocols =
    parsed.sequences.LoRa && parsed.sequences.LTE && parsed.sequences.BLE;
  if (!hasAllProtocols) {
    throw new Error("JSON is missing one or more protocol sequences.");
  }

  return parsed as PersistedSeq;
}
