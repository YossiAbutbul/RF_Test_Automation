import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { LoRa, LTE, BLE, AnyEvt } from "@/tests/runners";
import "./css/RunModal.css";

type Protocol = "LoRa" | "LTE" | "BLE";
type TestMode = "txPower" | "freqAccuracy";

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
  cwOn: "Send CW command",
  measure: "Measure from spectrum",
  cwOff: "Turn off CW",
  close: "Close sessions",
};

const ORDER: StepKey[] = [
  "connectAnalyzer",
  "configureAnalyzer",
  "connectDut",
  "cwOn",
  "measure",
  "cwOff",
  "close",
];

const initSteps = (): Record<StepKey, StepStatus> =>
  ORDER.reduce(
    (a, k) => ((a[k] = k === "connectAnalyzer" ? "doing" : "idle"), a),
    {} as Record<StepKey, StepStatus>
  );

type Props = {
  open: boolean;
  onClose: () => void;

  protocol?: Protocol;
  mode?: TestMode; // default = "txPower"
  testName?: string;

  defaultFreqHz?: number;
  defaultPowerDbm?: number;
  defaultMac?: string;

  minValue?: number | null;
  maxValue?: number | null;

  defaultPpmLimit?: number;
};

export default function RunModal({
  open,
  onClose,
  protocol = "LoRa",
  mode = "txPower",
  testName = mode === "freqAccuracy" ? "Frequency Accuracy" : "Tx Power",
  defaultFreqHz = 918_500_000,
  defaultPowerDbm = 14,
  defaultMac = "80E1271FD8DD",
  minValue = null,
  maxValue = null,
  defaultPpmLimit = 20,
}: Props) {
  // inputs
  const [mac, setMac] = useState(defaultMac || "");
  const [freqHz, setFreqHz] = useState(defaultFreqHz);
  const [powerDbm, setPowerDbm] = useState(defaultPowerDbm);
  const [ppmLimit, setPpmLimit] = useState<number>(defaultPpmLimit);

  // run state
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepStatus>>(initSteps());
  const [logs, setLogs] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // results
  const [resTx, setResTx] = useState<null | { measuredDbm?: number; pass?: boolean }>(null);
  const [resFa, setResFa] = useState<null | { measuredHz?: number; errorHz?: number; errorPpm?: number; pass?: boolean }>(null);

  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!open) {
      abort();
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canStart = useMemo(() => Number.isFinite(freqHz) && Number.isFinite(powerDbm), [freqHz, powerDbm]);

  const pushLog = (line: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const reset = () => {
    setRunning(false);
    setResTx(null);
    setResFa(null);
    setSteps(initSteps());
    setLogs([]);
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
    if (!canStart || running) return;
    const macOk = ensureMac();
    if (!macOk) return;

    reset();
    setRunning(true);

    pushLog(`Starting ${protocol} ${testName}...`);

    const handlers = {
      onStart: (e: AnyEvt) => {
        pushLog("Run started");
        const p = (e as any)?.params;
        if (p?.freq_hz && p?.earfcn) {
          pushLog(
            `LTE Params → Frequency: ${p.freq_hz} Hz (${(p.freq_hz / 1e6).toFixed(1)} MHz), EARFCN: ${p.earfcn}`
          );
        }
      },
      onStep: (e: AnyEvt) => {
        const key = (e as any).key as StepKey | undefined;
        if (key && ORDER.includes(key)) {
          const raw = (e as any).status;
          const status: StepStatus = raw === "error" ? "error" : raw === "done" ? "done" : "doing";
          setStepSeq(key, status);
        }
        if ((e as any).message) pushLog((e as any).message);

        if (typeof (e as any).measuredDbm === "number") {
          setResTx((f) => ({ ...(f || {}), measuredDbm: (e as any).measuredDbm }));
        }
        if (typeof (e as any).measuredHz === "number") {
          setResFa((f) => ({ ...(f || {}), measuredHz: (e as any).measuredHz }));
        }
        if (typeof (e as any).errorHz === "number" || typeof (e as any).errorPpm === "number") {
          setResFa((f) => ({
            ...(f || {}),
            errorHz: (e as any).errorHz,
            errorPpm: (e as any).errorPpm,
          }));
        }
      },
      onLog: (e: AnyEvt) => pushLog((e as any).message),
      onResult: (e: AnyEvt) => {
        setSteps((prev) => {
          const next = { ...prev };
          ORDER.forEach((k) => {
            if (next[k] === "doing") next[k] = "done";
          });
          return next;
        });

        if (mode === "freqAccuracy") {
          setResFa({
            measuredHz: (e as any).measuredHz,
            errorHz: (e as any).errorHz,
            errorPpm: (e as any).errorPpm,
            pass: (e as any).pass_ ?? undefined,
          });
          const ppm = (e as any).errorPpm;
          pushLog(
            `Measurement complete. f=${(e as any).measuredHz} Hz, err=${(e as any).errorHz} Hz${
              typeof ppm === "number" ? ` (${ppm.toFixed(3)} ppm)` : ""
            }`
          );
        } else {
          setResTx({ measuredDbm: (e as any).measuredDbm, pass: (e as any).pass_ ?? undefined });
          pushLog("Measurement complete.");
        }
      },
      onError: (e: AnyEvt) => {
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
        pushLog(`Error: ${(e as any).error}`);
        esRef.current?.close();
        esRef.current = null;
        setRunning(false);
      },
      onDone: () => {
        setSteps((prev) => {
          const next = { ...prev };
          ORDER.forEach((k) => {
            if (next[k] === "doing") next[k] = "done";
          });
          next.close = "done";
          return next;
        });
        setRunning(false);
        esRef.current?.close();
        esRef.current = null;
      },
    };

    let es: EventSource;
    if (protocol === "LoRa") {
      if (mode === "freqAccuracy") {
        es = LoRa.runLoRaFrequencyAccuracy({ mac: macOk, freqHz, powerDbm, ppmLimit }, handlers);
      } else {
        es = LoRa.runLoRaTxPower({ mac: macOk, freqHz, powerDbm, minValue, maxValue }, handlers);
      }
    } else if (protocol === "LTE") {
      if (mode === "freqAccuracy") {
        es = LTE.runLTEFrequencyAccuracy({ mac: macOk, freqHz, powerDbm, ppmLimit }, handlers);
      } else {
        es = LTE.runLTETxPower({ mac: macOk, freqHz, powerDbm, minValue, maxValue }, handlers);
      }
    } else {
      es = BLE.runBLECurrentConsumption({ mac: macOk }, handlers);
    }

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
    setStepSeq("close", "done");
    pushLog("Aborted by user.");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="tsq-modal-backdrop" role="dialog" aria-modal="true">
      <div className={`tsq-modal ${running ? "is-running" : ""}`}>
        {/* Header */}
        <div className="tsq-run-header">
          {running && <div className="tsq-spinner" />}
          <div className="tsq-modal-title">Run {testName} (Local)</div>
        </div>

        {/* Inputs (keep original grid class names) */}
        <div className={`tsq-run-form ${mode === "txPower" ? "txpower-grid" : "freqacc-grid"}`}>
          <label className="tsq-field">
            <span>MAC</span>
            <input
              className={`tsq-input${mac.trim().length < 6 ? " tsq-mac-warn" : ""}`}
              data-mac-input
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
          </label>
          <label className="tsq-field">
            <span>Power [dBm]</span>
            <input
              className="tsq-input"
              type="number"
              value={powerDbm}
              onChange={(e) => setPowerDbm(Number(e.target.value))}
              disabled={running}
            />
          </label>

          {mode === "freqAccuracy" ? (
            <label className="tsq-field">
              <span>PPM Limit</span>
              <input
                className="tsq-input"
                type="number"
                value={ppmLimit}
                onChange={(e) => setPpmLimit(Number(e.target.value))}
                disabled={running}
              />
            </label>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* Steps (exact structure: list + .icon + .label) */}
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

        {/* Progress bar block that your CSS animates */}
        <div className="tsq-progress">{running && <div className="bar" />}</div>

        {/* Result + status chips that your CSS styles */}
        <div className="tsq-result">
          {mode === "freqAccuracy" ? (
            <>
              {resFa?.measuredHz != null && <span>Measured:<b> {resFa.measuredHz.toLocaleString()} Hz</b> </span>}
              {resFa?.errorHz != null && <span className="tsq-chip">{resFa.errorHz} Hz error</span>}
              {resFa?.errorPpm != null && (
                <span className="tsq-chip">{resFa.errorPpm.toFixed(3)} ppm</span>
              )}
              {resFa?.pass != null && (
                <span className={`tsq-chip ${resFa.pass ? "pass" : "fail"}`}>
                  {resFa.pass ? "PASS" : "FAIL"}
                </span>
              )}
            </>
          ) : (
            <>
              {resTx?.measuredDbm != null && <span> Measured: <b>{resTx.measuredDbm.toFixed(2)} dBm</b></span>}
              {resTx?.pass != null && (
                <span className={`tsq-chip ${resTx.pass ? "pass" : "fail"}`}>
                  {resTx.pass ? "PASS" : "FAIL"}
                </span>
              )}
            </>
          )}
        </div>

        {/* Log panel (keep .tsq-run-log) */}
        <pre className="tsq-run-log" ref={logRef}>
          {logs.join("\n")}
        </pre>

        {/* Actions (keep .tsq-modal-actions + .tsq-btn classes) */}
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
