import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { openTestStream } from "@/api/tests";
import "./css/RunModal.css";

/** --------- Types & Labels --------- */

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

/** --------- Event payloads from SSE (union, permissive) --------- */
type StepEvt = {
  type: "step";
  key: StepKey;
  status: "start" | "done" | "error";
  message?: string;
  measuredDbm?: number;
  measuredHz?: number;
  errorHz?: number;
  errorPpm?: number;
};
type ResultEvt = {
  type: "result";
  measuredDbm?: number;
  measuredHz?: number;
  errorHz?: number;
  errorPpm?: number;
  pass_?: boolean | null;
};
type LogEvt = { type: "log"; message: string };
type StartEvt = { type: "start"; test: string; params: any };
type ErrEvt = { type: "error"; error: string };
type AnyEvt = StepEvt | ResultEvt | LogEvt | StartEvt | ErrEvt | Record<string, any>;

/** --------- Props --------- */
type Props = {
  open: boolean;
  onClose: () => void;

  mode?: TestMode; // default = "txPower"
  testName?: string;

  // Shared defaults
  defaultFreqHz?: number;
  defaultPowerDbm?: number;
  defaultMac?: string;

  // Tx-Power limits (optional)
  minValue?: number | null;
  maxValue?: number | null;

  // Freq-Accuracy tolerance (optional)
  defaultPpmLimit?: number;
};

export default function RunModal({
  open,
  onClose,
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

  // results: support both tests
  const [resTx, setResTx] = useState<null | { measuredDbm?: number; pass?: boolean }>(null);
  const [resFa, setResFa] = useState<
    | null
    | { measuredHz?: number; errorHz?: number; errorPpm?: number; pass?: boolean }
  >(null);

  // auto-scroll log
  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (!open) {
      abort();
      reset();
    } else {
      setTimeout(() => {
        document.querySelector<HTMLInputElement>("input[data-mac-input]")?.focus();
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canStart = useMemo(
    () => Number.isFinite(freqHz) && Number.isFinite(powerDbm),
    [freqHz, powerDbm]
  );

  const pushLog = (line: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const reset = () => {
    setRunning(false);
    setResTx(null);
    setResFa(null);
    setSteps(initSteps());
    setLogs([]);
  };

  // Sequential step setter: when a new step starts "doing", auto-finish previous "doing"
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
    const typed =
      window.prompt("Enter DUT MAC (hex, e.g. 80E1271FD8DD):", existing) || "";
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

    // Endpoint selection by mode
    let path: string;
    const isLTE = /lte/i.test(testName || "");

    if (mode === "freqAccuracy") {
      // NEW: route LTE FA to its own endpoint
      path = isLTE
        ? "/tests/lte-frequency-accuracy/stream"
        : "/tests/freq-accuracy/stream";
    } else {
      // Tx Power stays the same logic
      path = isLTE
        ? "/tests/lte-tx-power/stream"
        : "/tests/tx-power/stream";
    }

    // Log header
    if (mode === "freqAccuracy") {
      pushLog(
        `SSE ${path} (freq=${freqHz}, power=${powerDbm}, mac=${macOk}, ppm_limit=${ppmLimit})`
      );
    } else {
      pushLog(
        `SSE ${path} (freq=${freqHz}, power=${powerDbm}, mac=${macOk}${
          minValue != null ? `, min=${minValue}` : ""
        }${maxValue != null ? `, max=${maxValue}` : ""})`
      );
    }

    // Params per mode
    const body =
      mode === "freqAccuracy"
        ? {
            mac: macOk,
            freq_hz: freqHz,
            power_dbm: powerDbm,
            ppm_limit: ppmLimit ?? null,
          }
        : {
            mac: macOk,
            freq_hz: freqHz,
            power_dbm: powerDbm,
            min_value: minValue ?? null,
            max_value: maxValue ?? null,
          };

    const es = openTestStream(path, body, {
      // ⬇️ Minimal change: accept the start event payload and print LTE params (freq & EARFCN)
      onStart: (e: AnyEvt) => {
        pushLog("Run started");
        if (/lte/i.test(testName || "") && (e as StartEvt)?.params) {
          const p = (e as StartEvt).params;
          if (p.freq_hz && p.earfcn) {
            pushLog(
              `LTE Params → Frequency: ${p.freq_hz} Hz (${(p.freq_hz / 1e6).toFixed(
                1
              )} MHz), EARFCN: ${p.earfcn}`
            );
          }
        }
      },
      onStep: (e: AnyEvt) => {
        const key = (e as any).key as StepKey | undefined;
        if (key && ORDER.includes(key)) {
          const rawStatus = (e as any).status;
          const status: StepStatus =
            rawStatus === "error" ? "error" : rawStatus === "done" ? "done" : "doing";
          setStepSeq(key, status);
        }
        if ((e as any).message) pushLog((e as any).message);

        // progressive updates
        if (typeof (e as any).measuredDbm === "number") {
          setResTx((f) => ({ ...(f || {}), measuredDbm: (e as any).measuredDbm }));
        }
        if (typeof (e as any).measuredHz === "number") {
          setResFa((f) => ({ ...(f || {}), measuredHz: (e as any).measuredHz }));
        }
        if (
          typeof (e as any).errorHz === "number" ||
          typeof (e as any).errorPpm === "number"
        ) {
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
        es.close();
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
        es.close();
        esRef.current = null;
      },
    });

    // Guard: if the server closes without error/done
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
      <div className="tsq-modal">
        <div className="tsq-run-header">
          {running && <div className="tsq-spinner" />}
          <div className="tsq-modal-title">Run {testName} (Local)</div>
        </div>

        <div className={`tsq-run-form ${mode === "txPower" ? "txpower-grid" : "freqacc-grid"}`}>
          <label className="tsq-field">
            <span>MAC</span>
            <input
              className="tsq-input"
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
              <span>PPM Limit (±)</span>
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
                  onChange={() => {}}
                  placeholder="(use test config)"
                  disabled
                />
              </label>
              <label className="tsq-field">
                <span>Max [dBm] (optional)</span>
                <input
                  className="tsq-input"
                  type="number"
                  value={maxValue ?? ""}
                  onChange={() => {}}
                  placeholder="(use test config)"
                  disabled
                />
              </label>
            </>
          )}
        </div>

        <div className="tsq-run-meta">
          <div className="tsq-meta-item">
            <div className="tsq-meta-k">MAC</div>
            <div className="tsq-meta-v">{mac || "—"}</div>
          </div>
          <div className="tsq-meta-item">
            <div className="tsq-meta-k">Frequency</div>
            <div className="tsq-meta-v">{freqHz.toLocaleString()} Hz</div>
          </div>
          <div className="tsq-meta-item">
            <div className="tsq-meta-k">Power</div>
            <div className="tsq-meta-v">{powerDbm} dBm</div>
          </div>
          {mode === "freqAccuracy" && (
            <div className="tsq-meta-item">
              <div className="tsq-meta-k">PPM Limit</div>
              <div className="tsq-meta-v">±{ppmLimit}</div>
            </div>
          )}
        </div>

        <ol className="tsq-steps">
          {ORDER.map((k) => (
            <li key={k} className={`tsq-step ${steps[k]}`}>
              <span className="icon">
                <StatusIcon s={steps[k]} />
              </span>
              <span className="label">
                {LABEL[k]}
                {k === "connectDut" && mac ? ` (${mac})` : ""}
              </span>
            </li>
          ))}
        </ol>

        {running && (
          <div className="tsq-progress">
            <div className="bar" />
          </div>
        )}

        {/* Results */}
        {mode === "freqAccuracy" && resFa && (
          <div className="tsq-result">
            f: <strong>{resFa.measuredHz?.toLocaleString()} Hz</strong>{" "}
            {typeof resFa.errorHz === "number" && (
              <>
                &nbsp;| Δf: <strong>{resFa.errorHz} Hz</strong>
              </>
            )}
            {typeof resFa.errorPpm === "number" && (
              <>
                &nbsp;(<strong>{resFa.errorPpm.toFixed(3)} ppm</strong>)
              </>
            )}
            {typeof resFa.pass === "boolean" && (
              <span className={`tsq-chip ${resFa.pass ? "pass" : "fail"}`}>
                {resFa.pass ? "PASS" : "FAIL"}
              </span>
            )}
          </div>
        )}

        {mode === "txPower" && resTx && (
          <div className="tsq-result">
            Measured: <strong>{resTx.measuredDbm?.toFixed(2)} dBm</strong>
            {typeof resTx.pass === "boolean" && (
              <span className={`tsq-chip ${resTx.pass ? "pass" : "fail"}`}>
                {resTx.pass ? "PASS" : "FAIL"}
              </span>
            )}
          </div>
        )}

        {logs.length > 0 && (
          <pre ref={logRef} className="tsq-run-log">
            {logs.join("\n")}
          </pre>
        )}

        <div className="tsq-modal-actions">
          {!running ? (
            <>
              <button className="tsq-btn ghost" onClick={onClose}>
                Close
              </button>
              <button className="tsq-btn primary" onClick={start} disabled={!canStart}>
                Start
              </button>
            </>
          ) : (
            <button className="tsq-btn" onClick={abort}>
              Abort
            </button>
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
