import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { BLE } from "@/tests/runners"; // expects ble.ts to export BLE.{runBLETxPower, runBLEFreqAccuracy}
import "../css/RunModal.css";

type TestMode = "txPower" | "freqAccuracy";

type TxStepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "cwOn"
  | "saveReset"
  | "reconnectDut"
  | "toneStart"
  | "measure"
  | "close";

type FaStepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "cwOn"      // start BLE tone (auto-timeout on DUT)
  | "measure"   // measure after zoom passes (logs come from backend)
  | "close";

type StepKey = TxStepKey | FaStepKey;
type StepStatus = "idle" | "doing" | "done" | "error";

const LABEL: Record<StepKey, string> = {
  // shared
  connectAnalyzer: "Connect to spectrum analyzer",
  configureAnalyzer: "Configure analyzer",
  connectDut: "Connect to DUT (BLE)",
  measure: "Measure from spectrum",
  close: "Close sessions",
  // tx-power only
  cwOn: "Set BLE Power / Start Tone",
  saveReset: "Save & Reset DUT",
  reconnectDut: "Reconnect to DUT",
  toneStart: "Start BLE Test Tone",
};

const ORDER_TX: TxStepKey[] = [
  "connectAnalyzer",
  "configureAnalyzer",
  "connectDut",
  "cwOn",
  "saveReset",
  "reconnectDut",
  "toneStart",
  "measure",
  "close",
];

const ORDER_FA: FaStepKey[] = [
  "connectAnalyzer",
  "configureAnalyzer",
  "connectDut",
  "cwOn",     // start tone (no explicit stop in FA)
  "measure",  // after backend zooms
  "close",
];

function initSteps(order: StepKey[]): Record<StepKey, StepStatus> {
  return order.reduce(
    (a, k) => ((a[k] = k === "connectAnalyzer" ? "doing" : "idle"), a),
    {} as Record<StepKey, StepStatus>
  );
}

/** Map frequency (Hz) to BLE advertising/data channel index: round((f-2402MHz)/2MHz), clamped 0..39 */
function deriveBleChannel(freqHz: number | undefined | null): number {
  const f = Number(freqHz ?? 0);
  if (!Number.isFinite(f) || f <= 0) return 0; // default ch=0 (2402 MHz)
  const ch = Math.round((f - 2_402_000_000) / 2_000_000);
  return Math.max(0, Math.min(39, ch));
}

type Props = {
  open: boolean;
  onClose: () => void;

  // which test to run
  mode?: TestMode;

  // Common inputs
  defaultMac?: string;
  defaultFreqHz?: number; // used to derive channel for backend

  // Tx Power specific
  defaultPowerParamHex?: string; // e.g. "0x1F" or "31"
  minValue?: number | null;
  maxValue?: number | null;

  // Frequency Accuracy specific
  defaultPpmLimit?: number; // e.g. 40
};

export default function BleRunModal({
  open,
  onClose,
  mode = "txPower",

  defaultMac = "80E1271FD8DD",
  defaultFreqHz = 2_402_000_000,

  defaultPowerParamHex = "31",
  minValue = null,
  maxValue = null,

  defaultPpmLimit = 40,
}: Props) {
  const ORDER = mode === "txPower" ? (ORDER_TX as StepKey[]) : (ORDER_FA as StepKey[]);

  // Inputs
  const [mac, setMac] = useState(defaultMac);
  const [freqHz, setFreqHz] = useState(defaultFreqHz);
  const channel = useMemo(() => deriveBleChannel(freqHz), [freqHz]);

  const [powerParam, setPowerParam] = useState(defaultPowerParamHex); // txPower
  const [ppmLimit, setPpmLimit] = useState<number | null>(defaultPpmLimit ?? 40); // freqAccuracy

  // Run state
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepStatus>>(initSteps(ORDER));
  const [logs, setLogs] = useState<string[]>([]);

  // Results
  const [measuredDbm, setMeasuredDbm] = useState<number | undefined>(undefined);
  const [passTx, setPassTx] = useState<boolean | undefined>(undefined);

  const [measuredHz, setMeasuredHz] = useState<number | undefined>(undefined);
  const [errorHz, setErrorHz] = useState<number | undefined>(undefined);
  const [errorPpm, setErrorPpm] = useState<number | undefined>(undefined);
  const [passFa, setPassFa] = useState<boolean | undefined>(undefined);

  // SSE
  const esRef = useRef<EventSource | null>(null);

  // log autoscroll
  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // reset on close or mode change
  useEffect(() => {
    if (!open) resetModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const pushLog = (line: string) =>
    setLogs((p) => [...p, `[${new Date().toLocaleTimeString()}] ${line}`]);

  // Full reset
  const resetModal = () => {
    setRunning(false);
    setSteps(initSteps(ORDER));
    setLogs([]);

    setMeasuredDbm(undefined);
    setPassTx(undefined);
    setMeasuredHz(undefined);
    setErrorHz(undefined);
    setErrorPpm(undefined);
    setPassFa(undefined);

    setMac(defaultMac);
    setFreqHz(defaultFreqHz);
    setPowerParam(defaultPowerParamHex);
    setPpmLimit(defaultPpmLimit ?? 40);

    esRef.current?.close();
    esRef.current = null;
  };

  // Light clear for a new run
  const clearForRun = () => {
    setSteps(initSteps(ORDER));
    setLogs([]);

    setMeasuredDbm(undefined);
    setPassTx(undefined);
    setMeasuredHz(undefined);
    setErrorHz(undefined);
    setErrorPpm(undefined);
    setPassFa(undefined);

    esRef.current?.close();
    esRef.current = null;
  };

  const setStepSeq = (key: StepKey, status: StepStatus) =>
    setSteps((prev) => {
      const next = { ...prev };
      if (status === "doing") {
        for (const k of ORDER) {
          if (k === key) break;
          if (next[k] === "doing") next[k] = "done";
        }
      }
      next[key] = status;
      return next;
    });

  const ensureMac = (): string | null => {
    const existing = mac.trim();
    if (existing.length >= 6) return existing;
    const typed = window.prompt("Enter DUT MAC (hex, e.g. 80E1271FD8DD):", existing) || "";
    const clean = typed.trim();
    if (clean.length >= 6) {
      setMac(clean);
      return clean;
    }
    return null;
  };

  const start = () => {
    if (running) return;

    const macOk = ensureMac();
    if (!macOk) return;

    clearForRun();
    setRunning(true);

    if (mode === "txPower") {
      const hex = (powerParam || "").trim();
      const isHex = /^0x[0-9a-fA-F]+$/.test(hex) || /^[0-9a-fA-F]+$/.test(hex) || /^\d+$/.test(hex);
      if (!isHex) {
        pushLog('Invalid "Power Parameter". Use hex like 0x1F or 1F (or a decimal integer).');
        setRunning(false);
        return;
      }

      pushLog(`Starting BLE Tx Power… (MAC=${macOk}, ch=${channel}, param=${powerParam})`);
      const handlers = {
        onStart: (_e: any) => pushLog("Run started"),
        onStep: (e: any) => {
          const key = (e?.key as StepKey | undefined) || undefined;
          if (key && ORDER.includes(key)) {
            const raw = e?.status;
            const status: StepStatus = raw === "error" ? "error" : raw === "done" ? "done" : "doing";
            setStepSeq(key, status);
          }
          if (e?.message) pushLog(e.message);
          if (typeof e?.measuredDbm === "number") setMeasuredDbm(e.measuredDbm);
        },
        onLog: (e: any) => { if (e?.message) pushLog(e.message); },
        onResult: (e: any) => {
          setSteps((prev) => {
            const next = { ...prev };
            ORDER.forEach((k) => { if (next[k] === "doing") next[k] = "done"; });
            return next;
          });
          if (typeof e?.measuredDbm === "number") setMeasuredDbm(e.measuredDbm);
          if ("pass_" in e) setPassTx(e.pass_);
          pushLog("Measurement complete.");
        },
        onError: (e: any) => {
          setSteps((prev) => {
            const next = { ...prev };
            let marked = false;
            for (const k of ORDER) {
              if (!marked && next[k] === "doing") {
                next[k] = "error";
                marked = true;
              }
            }
            return next;
          });
          pushLog(`Error: ${String(e?.error || "stream error")}`);
          esRef.current?.close();
          esRef.current = null;
          setRunning(false);
        },
        onDone: (_e: any) => {
          setSteps((prev) => {
            const next = { ...prev };
            ORDER.forEach((k) => { if (next[k] === "doing") next[k] = "done"; });
            (next as any).close = "done";
            return next;
          });
          setRunning(false);
          esRef.current?.close();
          esRef.current = null;
        },
      };

      const es = BLE.runBLETxPower(
        {
          mac: macOk,
          powerParamHex: powerParam,
          channel,
          minValue: minValue ?? undefined,
          maxValue: maxValue ?? undefined,
        },
        handlers
      );
      setStepSeq("connectAnalyzer", "doing");
      esRef.current = es;
    } else {
      // Frequency Accuracy
      if (!(ppmLimit == null || Number.isFinite(Number(ppmLimit)))) {
        pushLog("Invalid PPM limit.");
        setRunning(false);
        return;
      }
      pushLog(`Starting BLE Frequency Accuracy… (MAC=${macOk}, ch=${channel}, ppmLimit=${ppmLimit ?? "—"})`);

      const handlers = {
        onStart: (_e: any) => pushLog("Run started"),
        onStep: (e: any) => {
          const key = (e?.key as StepKey | undefined) || undefined;
          if (key && ORDER.includes(key)) {
            const raw = e?.status;
            const status: StepStatus = raw === "error" ? "error" : raw === "done" ? "done" : "doing";
            setStepSeq(key, status);
          }
          if (e?.message) pushLog(e.message);
          if (typeof e?.measuredHz === "number") setMeasuredHz(e.measuredHz);
          if (typeof e?.errorHz === "number") setErrorHz(e.errorHz);
          if (typeof e?.errorPpm === "number") setErrorPpm(e.errorPpm);
        },
        onLog: (e: any) => { if (e?.message) pushLog(e.message); },
        onResult: (e: any) => {
          setSteps((prev) => {
            const next = { ...prev };
            ORDER.forEach((k) => { if (next[k] === "doing") next[k] = "done"; });
            return next;
          });
          if (typeof e?.measuredHz === "number") setMeasuredHz(e.measuredHz);
          if (typeof e?.errorHz === "number") setErrorHz(e.errorHz);
          if (typeof e?.errorPpm === "number") setErrorPpm(e.errorPpm);
          if ("pass_" in e) setPassFa(e.pass_);
          pushLog("Measurement complete.");
        },
        onError: (e: any) => {
          setSteps((prev) => {
            const next = { ...prev };
            let marked = false;
            for (const k of ORDER) {
              if (!marked && next[k] === "doing") {
                next[k] = "error";
                marked = true;
              }
            }
            return next;
          });
          pushLog(`Error: ${String(e?.error || "stream error")}`);
          esRef.current?.close();
          esRef.current = null;
          setRunning(false);
        },
        onDone: (_e: any) => {
          setSteps((prev) => {
            const next = { ...prev };
            ORDER.forEach((k) => { if (next[k] === "doing") next[k] = "done"; });
            (next as any).close = "done";
            return next;
          });
          setRunning(false);
          esRef.current?.close();
          esRef.current = null;
        },
      };

      const es = BLE.runBLEFreqAccuracy(
        {
          mac: macOk,
          channel,
          ppmLimit: ppmLimit ?? undefined,
        },
        handlers
      );
      setStepSeq("connectAnalyzer", "doing");
      esRef.current = es;
    }
  };

  const abort = () => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
    setStepSeq("close", "done");
    pushLog("Aborted by user.");
    onClose();
  };

  if (!open) return null;

  const title = mode === "txPower" ? "Run BLE Tx Power" : "Run BLE Frequency Accuracy";

  return (
    <div className="tsq-modal-backdrop" role="dialog" aria-modal="true">
      <div className={`tsq-modal ${running ? "is-running" : ""}`}>
        <div className="tsq-run-header">
          {running && <div className="tsq-spinner" />}
          <div className="tsq-modal-title">{title}</div>
        </div>

        {mode === "txPower" ? (
          <div className="tsq-run-form txpower-grid">
            <label className="tsq-field">
              <span>MAC</span>
              <input
                className={`tsq-input${mac.trim().length < 6 ? " tsq-mac-warn" : ""}`}
                value={mac}
                onChange={(e) => setMac(e.target.value)}
                disabled={running}
              />
            </label>

            <label className="tsq-field">
              <span>Frequency [Hz]</span>
              <input
                className="tsq-input"
                type="number"
                value={freqHz}
                onChange={(e) => setFreqHz(Number(e.target.value))}
                disabled={running}
              />
              {/* Derived channel: {channel} */}
            </label>

            <label className="tsq-field">
              <span>Power Parameter (hex)</span>
              <input
                className="tsq-input"
                value={powerParam}
                onChange={(e) => setPowerParam(e.target.value)}
                placeholder="e.g. 0x1F or 31"
                disabled={running}
              />
            </label>

            <label className="tsq-field">
              <span>Min [dBm] (optional)</span>
              <input
                className="tsq-input"
                type="number"
                value={minValue ?? ""}
                onChange={() => void 0}
                placeholder="—"
                disabled={running}
              />
            </label>
            <label className="tsq-field">
              <span>Max [dBm] (optional)</span>
              <input
                className="tsq-input"
                type="number"
                value={maxValue ?? ""}
                onChange={() => void 0}
                placeholder="—"
                disabled={running}
              />
            </label>
          </div>
        ) : (
          <div className="tsq-run-form freqacc-grid">
            <label className="tsq-field">
              <span>MAC</span>
              <input
                className={`tsq-input${mac.trim().length < 6 ? " tsq-mac-warn" : ""}`}
                value={mac}
                onChange={(e) => setMac(e.target.value)}
                disabled={running}
              />
            </label>

            <label className="tsq-field">
              <span>Frequency [Hz]</span>
              <input
                className="tsq-input"
                type="number"
                value={freqHz}
                onChange={(e) => setFreqHz(Number(e.target.value))}
                disabled={running}
              />
              {/* Derived channel: {channel} */}
            </label>

            <label className="tsq-field">
              <span>PPM Limit</span>
              <input
                className="tsq-input"
                type="number"
                value={ppmLimit ?? ""}
                onChange={(e) => setPpmLimit(e.target.value === "" ? null : Number(e.target.value))}
                placeholder="e.g. 40"
                disabled={running}
              />
            </label>
          </div>
        )}

        <ul className="tsq-steps">
          {ORDER.map((k) => {
            const st = steps[k];
            return (
              <li key={k} className={`tsq-step ${st}`}>
                <span className="icon">
                  {st === "doing" && <Loader2 className="spin" size={16} />}
                  {st === "done" && <CheckCircle size={16} />}
                  {st === "error" && <XCircle size={16} />}
                  {st === "idle" && <Circle size={16} />}
                </span>
                <span className="label">{LABEL[k]}</span>
              </li>
            );
          })}
        </ul>

        <div className="tsq-progress">{running && <div className="bar" />}</div>

        {mode === "txPower" ? (
          <div className="tsq-result">
            {measuredDbm != null && (
              <span>
                Measured: <b>{measuredDbm.toFixed(2)} dBm</b>
              </span>
            )}
            {passTx != null && (
              <span className={`tsq-chip ${passTx ? "pass" : "fail"}`}>
                {passTx ? "PASS" : "FAIL"}
              </span>
            )}
          </div>
        ) : (
          <div className="tsq-result">
            {measuredHz != null && (
              <span>
                Measured: <b>{measuredHz.toFixed(0)} Hz</b>
              </span>
            )}
            {errorHz != null && (
              <span>
                &nbsp; Δf: <b>{errorHz.toFixed(0)} Hz </b>
              </span>
            )}
            {errorPpm != null && (
              <span>
                Error: <b>{errorPpm.toFixed(2)} ppm</b>
              </span>
            )}
            {passFa != null && (
              <span className={`tsq-chip ${passFa ? "pass" : "fail"}`}>
                {passFa ? "PASS" : "FAIL"}
              </span>
            )}
          </div>
        )}

        {(running || logs.length > 0) && (
          <pre className="tsq-run-log" ref={logRef}>
            {logs.join("\n")}
          </pre>
        )}

        <div className="tsq-modal-actions">
          {!running ? (
            <button className="tsq-btn primary" onClick={start}>
              Start
            </button>
          ) : (
            <button className="tsq-btn" onClick={abort}>
              Abort
            </button>
          )}
          <button className="tsq-btn ghost" onClick={onClose} disabled={running}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
