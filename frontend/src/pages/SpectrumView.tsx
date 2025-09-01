import { useEffect, useMemo, useRef, useState } from "react";
import "./css/SpectrumView.css";
import {
  ping,
  connectAnalyzer,
  disconnectAnalyzer,
  configureSweep,
  getRawDataCsv,
  getSnapshot,
} from "@/api/analyzer";

/* ---------- Types ---------- */
type Snapshot = {
  centerHz?: number;
  spanHz?: number;
  rbwHz?: number;
  vbwHz?: number;
  refDbm?: number;
  identity?: string;
};

type SweepForm = {
  centerMHz: string;
  spanMHz: string;
  rbwMHz: string;
  vbwMHz: string;
  refDbm: string;
  dbPerDiv: string;
};

/* ---------- Helpers ---------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hzToMHz = (hz?: number) => (hz == null ? "" : (hz / 1e6).toString());
const MHzToHzNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1e6) : undefined;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---------- Component ---------- */
export default function SpectrumView() {
  // connection
  const [ip, setIp] = useState("172.16.10.1");
  const [port, setPort] = useState<number | undefined>(5555);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<string | undefined>();

  // canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1200, h: 600 });

  // polling / data
  const lastFrameRef = useRef<Float32Array | null>(null);
  const nextFrameRef = useRef<Float32Array | null>(null);
  const lastUpdateTsRef = useRef<number>(0);
  const pollingRef = useRef(false);
  const stopPollingRef = useRef(false);
  const backoffUntilRef = useRef(0);

  // trace / axes config
  const [dbPerDiv, setDbPerDiv] = useState(10);
  const [refLevel, setRefLevel] = useState(0);

  // form state
  const [tab, setTab] = useState<"config" | "markers">("config");
  const [form, setForm] = useState<SweepForm>({
    centerMHz: "",
    spanMHz: "",
    rbwMHz: "",
    vbwMHz: "",
    refDbm: "0",
    dbPerDiv: "10",
  });

  // resize (compact, keeps left card dominant)
  useEffect(() => {
    const onResize = () => {
      const maxW = Math.min(window.innerWidth - 200, 1600);
      const w = clamp(maxW, 1000, 1600);
      const h = Math.round(w * 0.55);
      setCanvasSize({ w, h });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---------- Connect / Disconnect ---------- */
  const handleToggleConnection = async () => {
    if (connecting) return;

    if (!connected) {
      setConnecting(true);
      try {
        await ping();
        const res = await connectAnalyzer({ ip, port });
        setConnected(true);
        setIdentity(res?.identity);
        stopPollingRef.current = false;
        await hydrateFromSnapshot();
        startPollingLoop();
      } catch (e) {
        console.error("Connect failed:", e);
      } finally {
        setConnecting(false);
      }
    } else {
      setConnecting(true);
      try {
        stopPollingRef.current = true;
        await disconnectAnalyzer();
        setConnected(false);
      } catch (e) {
        console.error("Disconnect failed:", e);
      } finally {
        setConnecting(false);
      }
    }
  };

  /* ---------- Snapshot → UI ---------- */
  const hydrateFromSnapshot = async () => {
    try {
      const snap: Snapshot = await getSnapshot();
      if (snap.identity) setIdentity(snap.identity);

      const centerMHz = hzToMHz(snap.centerHz);
      const spanMHz = hzToMHz(snap.spanHz);
      const rbwMHz = hzToMHz(snap.rbwHz);
      const vbwMHz = hzToMHz(snap.vbwHz);
      const ref = snap.refDbm ?? 0;

      setRefLevel(ref);
      setForm((f) => ({
        ...f,
        centerMHz,
        spanMHz,
        rbwMHz,
        vbwMHz,
        refDbm: ref.toString(),
        dbPerDiv: f.dbPerDiv || "10",
      }));

      const nDiv = Number(form.dbPerDiv);
      if (Number.isFinite(nDiv)) setDbPerDiv(nDiv);
    } catch (e) {
      console.warn("Snapshot hydrate warning:", e);
    }
  };

  /* ---------- Polling (unchanged cadence/backoff) ---------- */
  const startPollingLoop = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;

    while (!stopPollingRef.current) {
      const now = Date.now();
      if (now < backoffUntilRef.current) {
        await sleep(140);
        continue;
      }

      try {
        const csv = await getRawDataCsv();
        if (csv && typeof csv === "string") {
          const values = csv
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n));
          const arr = new Float32Array(values);
          lastFrameRef.current = nextFrameRef.current ?? arr;
          nextFrameRef.current = arr;
          lastUpdateTsRef.current = performance.now();
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes("timeout")) {
          backoffUntilRef.current = Date.now() + 1100;
        } else if (msg.includes("not-connected") || msg.includes("server-error")) {
          break;
        }
      }
      await sleep(90);
    }
    pollingRef.current = false;
  };

  /* ---------- Drawing loop ---------- */
  /* ---------- Drawing loop (Y labels only) ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const draw = () => {
      const { w, h } = canvasSize;

      // background
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      // grid
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      const cols = 10, rows = 10;
      for (let i = 1; i < cols; i++) {
        const x = Math.round((i * w) / cols) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let j = 1; j < rows; j++) {
        const y = Math.round((j * h) / rows) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // ----- Y-axis labels ONLY -----
      ctx.fillStyle = "#fff";
      const fontSize = Math.max(12, Math.min(20, Math.round(h * 0.025)));
      ctx.font = `${fontSize}px ui-sans-serif, system-ui, -apple-system`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      const ref = refLevel, div = dbPerDiv;
      for (let i = 0; i <= rows; i++) {
        const y = Math.round((i * h) / rows);
        ctx.fillText(`${ref - i * div} dBm`, 6, y + (i === 0 ? 8 : 0));
      }
      // --------------------------------

      // trace
      const last = lastFrameRef.current;
      const next = nextFrameRef.current;
      if (next) {
        let use = next;
        if (last && last.length === next.length) {
          const dt = performance.now() - lastUpdateTsRef.current;
          const alpha = Math.max(0, Math.min(1, dt / 90));
          const out = new Float32Array(next.length);
          for (let i = 0; i < next.length; i++) out[i] = last[i] + (next[i] - last[i]) * alpha;
          use = out;
        }

        ctx.strokeStyle = "#d0e421ff";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const n = use.length;
        const pixelsPerDiv = h / rows;
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * w;
          const v = use[i];
          const y = ((ref - v) / dbPerDiv) * pixelsPerDiv;
          const yy = Math.max(0, Math.min(h - 1, y));
          if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [canvasSize, refLevel, dbPerDiv]); // ⬅ removed form.centerMHz/form.spanMHz


  /* ---------- Apply Sweep (unchanged) ---------- */
  const handleApplySweep = async () => {
    if (!connected) return;

    stopPollingRef.current = true;
    await sleep(60);

    const centerHz = MHzToHzNumber(form.centerMHz);
    const spanHz = MHzToHzNumber(form.spanMHz);
    const rbwHz = MHzToHzNumber(form.rbwMHz);
    const vbwHz = MHzToHzNumber(form.vbwMHz);
    const ref = Number(form.refDbm);
    const div = Number(form.dbPerDiv);

    try {
      await configureSweep({
        centerHz,
        spanHz,
        rbwHz,
        vbwHz,
        refDbm: Number.isFinite(ref) ? clamp(ref, -150, 30) : undefined,
      });
      if (Number.isFinite(div)) setDbPerDiv(div);
      if (Number.isFinite(ref)) setRefLevel(ref);
      await hydrateFromSnapshot();
    } catch (e) {
      console.error("Sweep update error:", e);
    } finally {
      stopPollingRef.current = false;
      startPollingLoop();
    }
  };

  /* ---------- Max Hold ---------- */
  const handleMaxHold = async () => {
    if (!connected) return;
    try {
      await configureSweep({ traceMode: "MAX_HOLD" });
    } catch (e) {
      console.error("Max Hold failed:", e);
    }
  };

  const onFormChange = (key: keyof SweepForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const connectionButtonLabel = useMemo(() => {
    if (connecting) return connected ? "Disconnecting…" : "Connecting…";
    return connected ? "Disconnect" : "Connect";
  }, [connecting, connected]);

  /* ---------- Render ---------- */
  return (
    <div className="spectrum-page">
      {/* Compact header with toolbar */}
      <div className="header-row">
        <div className="title-side">
          <h1 className="page-title">Spectrum View</h1>
          <div className={`status-line ${connected ? "connected" : "disconnected"}`}>
            <span className="status-dot" aria-hidden />
            {connected && identity ? `Connected to ${identity}` : "Not connected"}
          </div>
        </div>

        <div className="toolbar">
          <input
            className="conn-input"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="IP"
          />
          <input
            className="conn-input"
            value={port ?? ""}
            onChange={(e) => setPort(e.target.value ? Number(e.target.value) : undefined)}
            placeholder="Port"
            type="number"
          />
          <button
            className={`btn ${connected ? "btn-danger" : "btn-primary"}`}
            onClick={handleToggleConnection}
            disabled={connecting}
          >
            {connectionButtonLabel}
          </button>
        </div>
      </div>

      <div className="content-row">
        {/* Left: spectrum */}
        <div className="plot-card">
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            className="spectrum-canvas"
          />
        </div>

        {/* Right: controls */}
        <div className="controls-card">
          <div className="tabs">
            <button
              className={`tab ${tab === "config" ? "active" : ""}`}
              onClick={() => setTab("config")}
            >
              Configuration
            </button>
            <button
              className={`tab ${tab === "markers" ? "active" : ""}`}
              onClick={() => setTab("markers")}
            >
              Markers
            </button>
          </div>

          <div className="tab-body">
            {tab === "config" ? (
              <div className="config-form">
                <div className="form-row">
                  <label className="field">
                    <span>Center Frequency [MHz]</span>
                    <input
                      value={form.centerMHz}
                      onChange={onFormChange("centerMHz")}
                      className="text-input"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="field">
                    <span>Span [MHz]</span>
                    <input
                      value={form.spanMHz}
                      onChange={onFormChange("spanMHz")}
                      className="text-input"
                      inputMode="decimal"
                    />
                  </label>
                </div>

                <div className="form-row">
                  <label className="field">
                    <span>RBW [MHz]</span>
                    <input
                      value={form.rbwMHz}
                      onChange={onFormChange("rbwMHz")}
                      className="text-input"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="field">
                    <span>VBW [MHz]</span>
                    <input
                      value={form.vbwMHz}
                      onChange={onFormChange("vbwMHz")}
                      className="text-input"
                      inputMode="decimal"
                    />
                  </label>
                </div>

                <div className="form-row">
                  <label className="field">
                    <span>Ref Level [dBm]</span>
                    <input
                      value={form.refDbm}
                      onChange={onFormChange("refDbm")}
                      className="text-input"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="field">
                    <span>dB / div</span>
                    <input
                      value={form.dbPerDiv}
                      onChange={onFormChange("dbPerDiv")}
                      className="text-input"
                      inputMode="decimal"
                    />
                  </label>
                </div>

                <div className="row-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={handleMaxHold}
                    disabled={!connected}
                  >
                    Max Hold
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleApplySweep}
                    disabled={!connected}
                  >
                    Apply Sweep
                  </button>
                </div>
              </div>
            ) : (
              <div className="markers-panel">
                <div className="markers-empty">No markers added</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
