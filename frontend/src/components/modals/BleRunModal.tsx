import { useEffect, useRef, useState } from "react";
import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import "../css/RunModal.css";

type StepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "cwOn"
  | "measure"
  | "cwOff"
  | "close";
type StepStatus = "idle" | "doing" | "done" | "error";

const LABEL: Record<StepKey, string> = {
  connectAnalyzer: "Connect to spectrum analyzer",
  configureAnalyzer: "Configure analyzer",
  connectDut: "Connect to DUT (BLE)",
  cwOn: "Send BLE command(s)",
  measure: "Measure from spectrum",
  cwOff: "Turn off CW",
  close: "Close sessions",
};

const ORDER: StepKey[] = ["connectAnalyzer", "configureAnalyzer", "connectDut", "cwOn", "measure", "cwOff", "close"];
const initSteps = (): Record<StepKey, StepStatus> =>
  ORDER.reduce((a, k) => ((a[k] = k === "connectAnalyzer" ? "doing" : "idle"), a), {} as Record<StepKey, StepStatus>);

type Props = {
  open: boolean;
  onClose: () => void;

  defaultMac?: string;
  defaultFreqHz?: number;        // 2402 MHz default
  defaultPowerParamHex?: string; // hex string e.g., "0x1F"

  minValue?: number | null;
  maxValue?: number | null;
};

export default function BleRunModal({
  open,
  onClose,
  defaultMac = "80E1271FD8DD",
  defaultFreqHz = 2402000000,
  defaultPowerParamHex = "0x1F",
  minValue = null,
  maxValue = null,
}: Props) {
  const [mac, setMac] = useState(defaultMac);
  const [freqHz, setFreqHz] = useState(defaultFreqHz);
  const [powerParam, setPowerParam] = useState(defaultPowerParamHex);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepStatus>>(initSteps);
  const [logs, setLogs] = useState<string[]>([]);
  const [measuredDbm, setMeasuredDbm] = useState<number | undefined>(undefined);
  const [passed, setPassed] = useState<boolean | undefined>(undefined);

  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  useEffect(() => { if (!open) reset(); }, [open]); // eslint-disable-line

  const pushLog = (line: string) => setLogs((p) => [...p, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const reset = () => {
    setRunning(false);
    setSteps(initSteps());
    setLogs([]);
    setMeasuredDbm(undefined);
    setPassed(undefined);
    setMac(defaultMac);
    setFreqHz(defaultFreqHz);
    setPowerParam(defaultPowerParamHex);
  };

  const setStepSeq = (key: StepKey, status: StepStatus) =>
    setSteps((prev) => {
      const next = { ...prev };
      if (status === "doing") {
        for (const k of ORDER) { if (k === key) break; if (next[k] === "doing") next[k] = "done"; }
      }
      next[key] = status;
      return next;
    });

  const ensureMac = (): string | null => {
    const existing = mac.trim();
    if (existing.length >= 6) return existing;
    const typed = window.prompt("Enter DUT MAC (hex, e.g. 80E1271FD8DD):", existing) || "";
    const clean = typed.trim();
    if (clean.length >= 6) { setMac(clean); return clean; }
    return null;
  };

  const start = () => {
    if (running) return;
    const macOk = ensureMac(); if (!macOk) return;

    const hex = powerParam.trim();
    const isHex = /^0x[0-9a-fA-F]+$/.test(hex) || /^[0-9a-fA-F]+$/.test(hex);
    if (!isHex) { pushLog('Invalid "Power Parameter". Use hex like 0x1F or 1F.'); return; }

    reset(); setRunning(true);
    pushLog("Starting BLE Tx Power (UI-only; backend wiring later)…");

    const simulate = async () => {
      try {
        setStepSeq("connectAnalyzer", "doing"); await new Promise((r) => setTimeout(r, 250)); setStepSeq("connectAnalyzer", "done");
        setStepSeq("configureAnalyzer", "doing"); await new Promise((r) => setTimeout(r, 250)); setStepSeq("configureAnalyzer", "done");
        setStepSeq("connectDut", "doing"); await new Promise((r) => setTimeout(r, 300)); setStepSeq("connectDut", "done");

        setStepSeq("cwOn", "doing");
        pushLog(`Would send BLE Power Parameter=${powerParam}, Freq=${freqHz} Hz`);
        await new Promise((r) => setTimeout(r, 350)); setStepSeq("cwOn", "done");

        setStepSeq("measure", "doing"); await new Promise((r) => setTimeout(r, 300)); setStepSeq("measure", "done");
        setStepSeq("cwOff", "doing"); await new Promise((r) => setTimeout(r, 200)); setStepSeq("cwOff", "done");

        setMeasuredDbm(undefined);
        if (minValue == null && maxValue == null) setPassed(undefined); else setPassed(true);

        setRunning(false);
        setSteps((prev) => ({ ...prev, close: "done" }));
        pushLog("Done (UI only).");
      } catch (e) {
        pushLog(`Error: ${String(e)}`);
        setRunning(false);
      }
    };
    void simulate();
  };

  const abort = () => {
    setRunning(false);
    setStepSeq("close", "done");
    pushLog("Aborted by user.");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="tsq-modal-backdrop" role="dialog" aria-modal="true">
      <div className={`tsq-modal ${running ? "is-running" : ""}`}>
        <div className="tsq-run-header">
          {running && <div className="tsq-spinner" />}
          <div className="tsq-modal-title">Run BLE Tx Power (Local)</div>
        </div>

        <div className="tsq-run-form txpower-grid">
          <label className="tsq-field">
            <span>MAC</span>
            <input className={`tsq-input${mac.trim().length < 6 ? " tsq-mac-warn" : ""}`} value={mac} onChange={(e) => setMac(e.target.value)} disabled={running} />
          </label>

          <label className="tsq-field">
            <span>Frequency [Hz]</span>
            <input className="tsq-input" type="number" value={freqHz} onChange={(e) => setFreqHz(Number(e.target.value))} disabled={running} />
          </label>

          <label className="tsq-field">
            <span>Power Parameter (hex)</span>
            <input className="tsq-input" value={powerParam} onChange={(e) => setPowerParam(e.target.value)} placeholder="e.g. 0x1F or 1F" disabled={running} />
          </label>

          <label className="tsq-field">
            <span>Min [dBm] (optional)</span>
            <input className="tsq-input" type="number" value={minValue ?? ""} onChange={() => void 0} placeholder="—" disabled={running} />
          </label>
          <label className="tsq-field">
            <span>Max [dBm] (optional)</span>
            <input className="tsq-input" type="number" value={maxValue ?? ""} onChange={() => void 0} placeholder="—" disabled={running} />
          </label>
        </div>

        <ul className="tsq-steps">
          {ORDER.map((k) => (
            <li key={k} className={`tsq-step ${steps[k]}`}>
              <span className="icon">
                {steps[k] === "doing" && <Loader2 className="spin" size={16} />}
                {steps[k] === "done" && <CheckCircle size={16} />}
                {steps[k] === "error" && <XCircle size={16} />}
                {steps[k] === "idle" && <Circle size={16} />}
              </span>
              <span className="label">{LABEL[k]}</span>
            </li>
          ))}
        </ul>

        <div className="tsq-progress">{running && <div className="bar" />}</div>

        <div className="tsq-result">
          {measuredDbm != null && (<span>Measured: <b>{measuredDbm.toFixed(2)} dBm</b></span>)}
          {passed != null && (<span className={`tsq-chip ${passed ? "pass" : "fail"}`}>{passed ? "PASS" : "FAIL"}</span>)}
        </div>

        {(running || logs.length > 0) && <pre className="tsq-run-log" ref={logRef}>{logs.join("\n")}</pre>}

        <div className="tsq-modal-actions">
          {!running ? <button className="tsq-btn primary" onClick={start}>Start</button>
                    : <button className="tsq-btn" onClick={abort}>Abort</button>}
          <button className="tsq-btn ghost" onClick={onClose} disabled={running}>Close</button>
        </div>
      </div>
    </div>
  );
}
