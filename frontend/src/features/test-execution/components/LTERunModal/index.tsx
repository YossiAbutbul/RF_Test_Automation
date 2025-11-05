import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { LTE, AnyEvt } from "@/tests/runners";
import { StepStatus, TxPowerResult, FreqAccuracyResult } from "../../types/test-execution.types";
import "../RunModal/RunModal.css";

type StepKey =
  | "connectAnalyzer"
  | "configureAnalyzer"
  | "connectDut"
  | "modemOn"
  | "cwOn"
  | "measure"
  | "cwOff"
  | "close";

const LABEL: Record<StepKey, string> = {
  connectAnalyzer: "Connect to spectrum analyzer",
  configureAnalyzer: "Configure analyzer",
  connectDut: "Connect to DUT (LTE)",
  modemOn: "Turning LTE modem on",
  cwOn: "Send CW command",
  measure: "Measure from spectrum",
  cwOff: "Turn off CW",
  close: "Close sessions",
};

const ORDER: StepKey[] = [
  "connectAnalyzer",
  "configureAnalyzer",
  "connectDut",
  "modemOn",
  "cwOn",
  "measure",
  "cwOff",
  "close",
];

const initSteps = (): Record<StepKey, StepStatus> =>
  ORDER.reduce((a, k) => ((a[k] = k === "connectAnalyzer" ? "doing" : "idle"), a), {} as Record<StepKey, StepStatus>);

const fmtIntWithCommas = (n: number) => Math.round(n).toLocaleString("en-US");

type Mode = "txPower" | "freqAccuracy" | "obw";

type Props = {
  open: boolean;
  onClose: () => void;
  mode?: Mode;
  testName?: string;

  defaultFreqHz?: number;
  defaultPowerDbm?: number;
  defaultMac?: string;

  minValue?: number | null;
  maxValue?: number | null;

  defaultPpmLimit?: number;

  // OBW (LTE)
  obwMcs?: string;       // default "5"
  obwNbIndex?: string;   // default "0"
  obwNumRbAlloc?: string;
  obwPosRbAlloc?: string;
};

export default function LteRunModal({
  open,
  onClose,
  mode = "txPower",
  testName = mode === "freqAccuracy" ? "Frequency Accuracy" : mode === "obw" ? "OBW" : "Tx Power",
  defaultFreqHz = 1_715_000_000,
  defaultPowerDbm = 23,
  defaultMac = "80E1271FD8B8",
  minValue = null,
  maxValue = null,
  defaultPpmLimit = 20,
  obwMcs = "5",
  obwNbIndex = "0",
  obwNumRbAlloc = "",
  obwPosRbAlloc = "",
}: Props) {
  const [mac, setMac] = useState(defaultMac);
  const [freqHz, setFreqHz] = useState(defaultFreqHz);
  const [powerDbm, setPowerDbm] = useState(defaultPowerDbm);
  const [ppmLimit, setPpmLimit] = useState<number>(defaultPpmLimit);

  // OBW (LTE)
  const [mcs, setMcs] = useState(obwMcs);
  const [nbIndex, setNbIndex] = useState(obwNbIndex);
  const [numRb, setNumRb] = useState(obwNumRbAlloc);
  const [posRb, setPosRb] = useState(obwPosRbAlloc);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepStatus>>(initSteps);
  const [logs, setLogs] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const [resTx, setResTx] = useState<null | { measuredDbm?: number; pass?: boolean }>(null);
  const [resFa, setResFa] = useState<null | { measuredHz?: number; errorHz?: number; errorPpm?: number; pass?: boolean }>(null);

  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  useEffect(() => { if (!open) { abort(); reset(); } }, [open]); // eslint-disable-line

  const canStart = useMemo(() => {
    if (mode === "freqAccuracy") return Number.isFinite(freqHz);
    if (mode === "obw") return Number.isFinite(freqHz) && Number.isFinite(powerDbm);
    return Number.isFinite(freqHz) && Number.isFinite(powerDbm);
  }, [freqHz, powerDbm, mode]);

  const pushLog = (line: string) => setLogs((p) => [...p, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const reset = () => {
    setRunning(false);
    setResTx(null);
    setResFa(null);
    setSteps(initSteps());
    setLogs([]);
    setMac(defaultMac);
    setFreqHz(defaultFreqHz);
    setPowerDbm(defaultPowerDbm);
    setPpmLimit(defaultPpmLimit);
    setMcs(obwMcs);
    setNbIndex(obwNbIndex);
    setNumRb(obwNumRbAlloc);
    setPosRb(obwPosRbAlloc);
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
    if (!canStart || running) return;
    const macOk = ensureMac(); if (!macOk) return;

    reset(); setRunning(true);
    pushLog(`Starting LTE ${testName}...`);

    if (mode === "obw") {
      // Wire up to backend later (LTE.runLteObw({...}))
      pushLog(`OBW (LTE) — freq=${freqHz} Hz, power=${powerDbm} dBm, MCS=${mcs}, NB=${nbIndex}, RBs=${numRb}, Pos=${posRb}`);
      pushLog("OBW runner not wired yet. This is a UI-only placeholder.");
      setRunning(false);
      return;
    }

    const handlers = {
      onStart: (_e: AnyEvt) => pushLog("Run started"),
      onStep: (e: AnyEvt) => {
        const key = (e as any).key as StepKey | undefined;
        if (key && ORDER.includes(key)) {
          const raw = (e as any).status;
          const status: StepStatus = raw === "error" ? "error" : raw === "done" ? "done" : "doing";
          setStepSeq(key, status);
        }
        if ((e as any).message) pushLog((e as any).message);

        if (typeof (e as any).measuredDbm === "number") setResTx((f) => ({ ...(f || {}), measuredDbm: (e as any).measuredDbm }));
        if (typeof (e as any).measuredHz === "number") setResFa((f) => ({ ...(f || {}), measuredHz: (e as any).measuredHz }));
        if ((e as any).errorHz != null || (e as any).errorPpm != null)
          setResFa((f) => ({ ...(f || {}), errorHz: (e as any).errorHz, errorPpm: (e as any).errorPpm }));
      },
      onLog: (e: AnyEvt) => pushLog((e as any).message),
      onResult: (e: AnyEvt) => {
        setSteps((prev) => { const next = { ...prev }; ORDER.forEach((k) => { if (next[k] === "doing") next[k] = "done"; }); return next; });
        if (mode === "freqAccuracy") {
          setResFa({ measuredHz: (e as any).measuredHz, errorHz: (e as any).errorHz, errorPpm: (e as any).errorPpm, pass: (e as any).pass_ ?? undefined });
          const ppm = (e as any).errorPpm;
          pushLog(`Measurement complete. f=${(e as any).measuredHz} Hz, err=${(e as any).errorHz} Hz${typeof ppm === "number" ? ` (${ppm.toFixed(3)} ppm)` : ""}`);
        } else {
          setResTx({ measuredDbm: (e as any).measuredDbm, pass: (e as any).pass_ ?? undefined });
          pushLog("Measurement complete.");
        }
      },
      onError: (e: AnyEvt) => {
        setSteps((prev) => { const next = { ...prev }; let marked = false; for (const k of ORDER) { if (!marked && next[k] === "doing") { next[k] = "error"; marked = true; } } return next; });
        pushLog(`Error: ${(e as any).error}`);
        esRef.current?.close(); esRef.current = null; setRunning(false);
      },
      onDone: () => {
        setSteps((prev) => { const next = { ...prev }; ORDER.forEach((k) => { if (next[k] === "doing") next[k] = "done"; }); next.close = "done"; return next; });
        setRunning(false); esRef.current?.close(); esRef.current = null;
      },
    };

    let es: EventSource;
    if (mode === "freqAccuracy") {
      es = LTE.runLTEFrequencyAccuracy({ mac: macOk, freqHz, powerDbm, ppmLimit }, handlers);
    } else {
      es = LTE.runLTETxPower({ mac: macOk, freqHz, powerDbm, minValue, maxValue }, handlers);
    }

    es.onerror = () => { pushLog("Stream closed unexpectedly."); es.close(); esRef.current = null; setRunning(false); };
    esRef.current = es;
  };

  const abort = () => {
    esRef.current?.close(); esRef.current = null; setRunning(false);
    setStepSeq("close", "done"); pushLog("Aborted by user."); onClose();
  };

  if (!open) return null;

  return (
    <div className="tsq-modal-backdrop" role="dialog" aria-modal="true">
      <div className={`tsq-modal ${running ? "is-running" : ""}`}>
        <div className="tsq-run-header">{running && <div className="tsq-spinner" />}<div className="tsq-modal-title">Run {testName} (LTE)</div></div>

        <div className={`tsq-run-form ${mode === "freqAccuracy" ? "freqacc-grid" : "txpower-grid"}`}>
          <label className="tsq-field"><span>MAC</span>
            <input className={`tsq-input${mac.trim().length < 6 ? " tsq-mac-warn" : ""}`} value={mac} onChange={(e) => setMac(e.target.value)} disabled={running} />
          </label>
          <label className="tsq-field"><span>Frequency [Hz]</span>
            <input className="tsq-input" type="number" value={freqHz} onChange={(e) => setFreqHz(Number(e.target.value))} disabled={running} />
            {/* later: map from EARFCN in YAML */}
          </label>

          {mode === "freqAccuracy" ? (
            <label className="tsq-field"><span>PPM Limit</span>
              <input className="tsq-input" type="number" value={ppmLimit} onChange={(e) => setPpmLimit(Number(e.target.value))} disabled={running} />
            </label>
          ) : mode === "obw" ? (
            <>
              <label className="tsq-field"><span>Power [dBm]</span>
                <input className="tsq-input" type="number" value={powerDbm} onChange={(e) => setPowerDbm(Number(e.target.value))} disabled={running} />
              </label>
              <label className="tsq-field"><span>MCS</span>
                <input className="tsq-input" value={mcs} onChange={(e) => setMcs(e.target.value)} disabled={running} placeholder="default 5" />
              </label>
              <label className="tsq-field"><span>NB Index</span>
                <input className="tsq-input" value={nbIndex} onChange={(e) => setNbIndex(e.target.value)} disabled={running} placeholder="default 0" />
              </label>
              <label className="tsq-field"><span>Number of RB Allocation</span>
                <input className="tsq-input" value={numRb} onChange={(e) => setNumRb(e.target.value)} disabled={running} />
              </label>
              <label className="tsq-field"><span>Position of RB Allocation</span>
                <input className="tsq-input" value={posRb} onChange={(e) => setPosRb(e.target.value)} disabled={running} />
              </label>
            </>
          ) : (
            <>
              <label className="tsq-field"><span>Power [dBm]</span>
                <input className="tsq-input" type="number" value={powerDbm} onChange={(e) => setPowerDbm(Number(e.target.value))} disabled={running} />
              </label>
              <label className="tsq-field"><span>Min [dBm] (optional)</span>
                <input className="tsq-input" type="number" value={minValue ?? ""} onChange={() => void 0} placeholder="—" disabled={running} />
              </label>
              <label className="tsq-field"><span>Max [dBm] (optional)</span>
                <input className="tsq-input" type="number" value={maxValue ?? ""} onChange={() => void 0} placeholder="—" disabled={running} />
              </label>
            </>
          )}
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
          {mode === "freqAccuracy" ? (
            <>
              {resFa?.measuredHz != null && (<span>Measured: <b>{fmtIntWithCommas(resFa.measuredHz)} Hz</b></span>)}
              {resFa?.errorHz != null && (<span>&nbsp; Δf: <b>{fmtIntWithCommas(resFa.errorHz)} Hz</b></span>)}
              {resFa?.errorPpm != null && (<span>&nbsp; Error: <b>{resFa.errorPpm.toFixed(2)} ppm</b></span>)}
              {resFa?.pass != null && (<span className={`tsq-chip ${resFa.pass ? "pass" : "fail"}`}>{resFa.pass ? "PASS" : "FAIL"}</span>)}
            </>
          ) : (
            <>
              {resTx?.measuredDbm != null && <span> Measured: <b>{resTx.measuredDbm.toFixed(2)} dBm</b></span>}
              {resTx?.pass != null && <span className={`tsq-chip ${resTx.pass ? "pass" : "fail"}`}>{resTx.pass ? "PASS" : "FAIL"}</span>}
            </>
          )}
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
