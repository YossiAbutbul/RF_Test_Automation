import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { openTestStream } from "@/api/tests";
import "../components/css/RunModal.css";

type StepKey = "connectAnalyzer" | "configureAnalyzer" | "connectDut" | "cwOn" | "measure" | "cwOff" |"close";
type StepStatus = "idle" | "doing" | "done" | "error";

const LABEL: Record<StepKey, string> = {
  connectAnalyzer: "Connect to spectrum analyzer",
  configureAnalyzer: "Configure analyzer",
  connectDut: "Connect to DUT (BLE)",
  cwOn: "Send CW command",
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
  testName?: string;
  defaultFreqHz?: number;
  defaultPowerDbm?: number;
  defaultMac?: string;
  minValue?: number;
  maxValue?: number;
};

export default function RunModal({
  open,
  onClose,
  testName = "Tx Power",
  defaultFreqHz = 918_500_000,
  defaultPowerDbm = 14,
  defaultMac,
  minValue,
  maxValue,
}: Props) {
  const [mac, setMac] = useState(defaultMac || "");
  const [freqHz, setFreqHz] = useState(defaultFreqHz);
  const [powerDbm, setPowerDbm] = useState(defaultPowerDbm);

  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState<null | { measuredDbm?: number; pass?: boolean }>(null);
  const [steps, setSteps] = useState<Record<StepKey, StepStatus>>(initSteps());
  const [logs, setLogs] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!open) { abort(); reset(); }
    else setTimeout(() => document.querySelector<HTMLInputElement>("input[data-mac-input]")?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canStart = useMemo(() => Number.isFinite(freqHz) && Number.isFinite(powerDbm), [freqHz, powerDbm]);
  const pushLog = (line: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);
  const setStep = (k: StepKey, s: StepStatus) => setSteps((prev) => ({ ...prev, [k]: s }));
  const reset = () => { setRunning(false); setFinished(null); setSteps(initSteps()); setLogs([]); };

  const ensureMac = (): string | null => {
    const existing = mac.trim();
    if (existing.length >= 6) return existing;
    const last = localStorage.getItem("rfapp.lastMac") || "";
    const typed = window.prompt("Enter DUT MAC (hex, e.g. D5A9F012CC39):", existing || last) || "";
    const clean = typed.trim();
    if (clean.length >= 6) { setMac(clean); localStorage.setItem("rfapp.lastMac", clean); return clean; }
    return null;
  };

  const start = () => {
    if (!canStart || running) return;
    const macOk = ensureMac();
    if (!macOk) return;

    reset();
    setRunning(true);
    pushLog(`SSE /tests/tx-power/stream (freq=${freqHz}, power=${powerDbm}, mac=${macOk})`);

    const es = openTestStream("/tests/tx-power/stream", {
      mac: macOk,
      freq_hz: freqHz,
      power_dbm: powerDbm,
      min_value: minValue ?? null,
      max_value: maxValue ?? null,
    }, {
      onStart: () => pushLog("Run started"),
      onStep: (e) => {
        const key = (e.key || "") as StepKey;
        if (ORDER.includes(key)) setStep(key, e.status === "error" ? "error" : e.status === "done" ? "done" : "doing");
        if (e.message) pushLog(e.message);
        if (typeof e.measuredDbm === "number") setFinished((f) => ({ ...(f || {}), measuredDbm: e.measuredDbm }));
      },
      onLog: (e) => pushLog(e.message),
      onResult: (e) => {
        setFinished({ measuredDbm: e.measuredDbm, pass: e.pass_ ?? undefined });
        pushLog("Measurement complete.");
      },
      onError: (e) => {
        setStep("measure", "error");
        pushLog(`Error: ${e.error}`);
        es.close();                  // prevent auto-retry loop
        esRef.current = null;
        setRunning(false);
      },
      onDone: () => {
        setStep("close", "done");
        setRunning(false);
        es.close();
        esRef.current = null;
      },
    });

    // Guard: if the server closes without error/done, stop retry + surface it
    es.onerror = () => {
      pushLog("Stream closed unexpectedly.");
      es.close();
      esRef.current = null;
      setRunning(false);
    };

    esRef.current = es;
  };

  const abort = () => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
    setStep("close", "done");
    pushLog("Aborted by user.");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="tsq-modal-backdrop" role="dialog" aria-modal="true">
      <div className="tsq-modal">
        <div className="tsq-run-header">
          {running && <div className="tsq-spinner" />}
          <div className="tsq-modal-title">Run {testName} (Local)</div>
        </div>

        <div className="tsq-run-form">
          <label className="tsq-field">
            <span>MAC</span>
            <input className="tsq-input" data-mac-input value={mac} onChange={(e) => setMac(e.target.value)} disabled={running} />
          </label>
          <label className="tsq-field">
            <span>Frequency [Hz]</span>
            <input className="tsq-input" type="number" value={freqHz} onChange={(e) => setFreqHz(Number(e.target.value))} disabled={running} />
          </label>
          <label className="tsq-field">
            <span>Power [dBm]</span>
            <input className="tsq-input" type="number" value={powerDbm} onChange={(e) => setPowerDbm(Number(e.target.value))} disabled={running} />
          </label>
        </div>

        <div className="tsq-run-meta">
          <div className="tsq-meta-item"><div className="tsq-meta-k">MAC</div><div className="tsq-meta-v">{mac || "—"}</div></div>
          <div className="tsq-meta-item"><div className="tsq-meta-k">Frequency</div><div className="tsq-meta-v">{freqHz.toLocaleString()} Hz</div></div>
          <div className="tsq-meta-item"><div className="tsq-meta-k">Power</div><div className="tsq-meta-v">{powerDbm} dBm</div></div>
        </div>

        <ol className="tsq-steps">
          {ORDER.map((k) => (
            <li key={k} className={`tsq-step ${steps[k]}`}>
              <span className="icon"><StatusIcon s={steps[k]} /></span>
              <span className="label">{LABEL[k]}{k === "connectDut" && mac ? ` (${mac})` : ""}</span>
            </li>
          ))}
        </ol>

        {running && <div className="tsq-progress"><div className="bar" /></div>}

        {finished && (
          <div className="tsq-result">
            Measured: <strong>{finished.measuredDbm?.toFixed(2)} dBm</strong>
            {typeof finished.pass === "boolean" && (
              <span className={`tsq-chip ${finished.pass ? "pass" : "fail"}`}>{finished.pass ? "PASS" : "FAIL"}</span>
            )}
          </div>
        )}

        {logs.length > 0 && <pre className="tsq-run-log">{logs.join("\n")}</pre>}

        <div className="tsq-modal-actions">
          {!running ? (
            <>
              <button className="tsq-btn ghost" onClick={onClose}>Close</button>
              <button className="tsq-btn primary" onClick={start} disabled={!canStart}>Start</button>
            </>
          ) : (
            <button className="tsq-btn" onClick={abort}>Abort</button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ s }: { s: StepStatus }) {
  if (s === "done") return <CheckCircle size={16} className="ok" />;
  if (s === "doing") return <Loader2 size={16} className="spin" />;
  if (s === "error") return <XCircle size={16} className="err" />;
  return <Circle size={14} className="idle" />;
}
