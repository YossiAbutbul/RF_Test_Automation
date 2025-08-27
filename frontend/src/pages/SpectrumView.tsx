import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  connectAnalyzer,
  disconnectAnalyzer,
  getRawDataCsv,
  getSnapshot,
  configureSweep,
} from "../api/analyzer";

type Snapshot = {
  centerHz?: number;
  spanHz?: number;
  rbwHz?: number;
  vbwHz?: number;
  refDbm?: number;
};

type TraceMode = "CLEAR_WRITE" | "MAX_HOLD";

const CANVAS_W = 900;
const CANVAS_H = 420;
const GRID_DIVS = 10;
const POLL_INTERVAL_MS = 90; // smooth but not frantic

export default function SpectrumView() {
  // connection
  const [ip, setIp] = useState("172.16.10.1");
  const [port, setPort] = useState(5555);
  const [isConnected, setIsConnected] = useState(false);
  const isConnectedRef = useRef(false);
  const [identity, setIdentity] = useState<string | null>(null);

  // sweep (UI state always mirrors the instrument; initialize to sensible defaults)
  const [centerMHz, setCenterMHz] = useState(2400);
  const [spanMHz, setSpanMHz] = useState(20);
  const [rbwMHz, setRbwMHz] = useState(1);
  const [vbwMHz, setVbwMHz] = useState(3);
  const [refLevel, setRefLevel] = useState(-20);
  const [dbPerDiv, setDbPerDiv] = useState(10);

  // trace
  const [traceMode, setTraceMode] = useState<TraceMode>("CLEAR_WRITE");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maxHoldBuf = useRef<Float32Array | null>(null);
  const lastTrace = useRef<Float32Array | null>(null);
  const renderReq = useRef<number | null>(null);

  // polling control
  const pollingTimer = useRef<number | null>(null);
  const pollingBusy = useRef(false);

  // ---------- helpers ----------
  const hzToMHz = (hz?: number) => (hz ?? 0) / 1e6;
  const mhzToHz = (mhz: number) => Math.max(0, mhz) * 1e6;

  const clearMax = () => {
    maxHoldBuf.current = null;
  };

  // ---------- drawing ----------
  const drawGridAndAxes = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      // background
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // grid
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1;

      const dx = CANVAS_W / GRID_DIVS;
      const dy = CANVAS_H / GRID_DIVS;

      ctx.beginPath();
      for (let i = 0; i <= GRID_DIVS; i++) {
        const x = Math.round(i * dx) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
      }
      for (let j = 0; j <= GRID_DIVS; j++) {
        const y = Math.round(j * dy) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
      }
      ctx.stroke();

      // axes labels
      ctx.fillStyle = "#bbb";
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica";

      // X labels: center/span
      const startMHz = centerMHz - spanMHz / 2;
      const stopMHz = centerMHz + spanMHz / 2;
      const xLbl = `${startMHz.toFixed(3)} MHz  —  ${centerMHz.toFixed(3)} MHz  —  ${stopMHz.toFixed(3)} MHz`;
      ctx.fillText(xLbl, 14, CANVAS_H - 8);

      // Y labels from refLevel and db/div
      for (let i = 0; i <= GRID_DIVS; i++) {
        const y = Math.round(i * dy);
        const value = refLevel - i * dbPerDiv;
        const txt = `${value.toFixed(0)} dBm`;
        ctx.fillText(txt, 10, Math.min(CANVAS_H - 14, Math.max(14, y + 4)));
      }
    },
    [centerMHz, spanMHz, refLevel, dbPerDiv]
  );

  const drawTrace = useCallback(
    (ctx: CanvasRenderingContext2D, buf: Float32Array, color: string) => {
      if (!buf || buf.length === 0) return;
      const minY = refLevel - GRID_DIVS * dbPerDiv;
      const maxY = refLevel;

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.beginPath();

      const n = buf.length;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * (CANVAS_W - 1);
        const dbm = buf[i];
        // clamp
        const yVal = Math.max(minY, Math.min(maxY, dbm));
        const y = ((maxY - yVal) / (maxY - minY)) * (CANVAS_H - 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    [refLevel, dbPerDiv]
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawGridAndAxes(ctx);

    // live trace
    const l = lastTrace.current;
    if (l) drawTrace(ctx, l, "#8b5cf6"); // purple

    // max hold overlay
    const h = maxHoldBuf.current;
    if (h) drawTrace(ctx, h, "#f59e0b"); // amber
    renderReq.current = requestAnimationFrame(render);
  }, [drawGridAndAxes, drawTrace]);

  const startRendering = useCallback(() => {
    if (renderReq.current != null) return;
    renderReq.current = requestAnimationFrame(render);
  }, [render]);

  const stopRendering = useCallback(() => {
    if (renderReq.current != null) {
      cancelAnimationFrame(renderReq.current);
      renderReq.current = null;
    }
  }, []);

  // ---------- polling ----------
  const pollOnce = useCallback(async () => {
    if (pollingBusy.current) return;
    pollingBusy.current = true;
    try {
      const csv = await getRawDataCsv(); // analyzer.ts handles its own timeout (~2s)
      // CSV → Float32Array
      const parts = csv.split(",").map((s) => parseFloat(s));
      const arr = new Float32Array(parts.length);
      for (let i = 0; i < parts.length; i++) arr[i] = parts[i];

      // update live
      lastTrace.current = arr;

      // update max-hold locally if enabled
      if (traceMode === "MAX_HOLD") {
        const h = maxHoldBuf.current;
        if (!h || h.length !== arr.length) {
          maxHoldBuf.current = new Float32Array(arr);
        } else {
          for (let i = 0; i < arr.length; i++) {
            if (arr[i] > h[i]) h[i] = arr[i];
          }
        }
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("timeout")) {
        console.warn("Polling timeout — backing off.");
      } else if (msg.includes("not-connected") || msg.includes("server-error")) {
        console.warn("Polling error:", msg);
      } else {
        console.warn("Polling error:", e);
      }
      // gentle backoff handled below by interval delay
    } finally {
      pollingBusy.current = false;
    }
  }, [traceMode]);

  const startPolling = useCallback(() => {
    if (pollingTimer.current != null) return;
    // do one immediately for fast first paint
    void pollOnce();
    pollingTimer.current = window.setInterval(() => {
      if (!isConnectedRef.current) return;
      void pollOnce();
    }, POLL_INTERVAL_MS) as unknown as number;
  }, [pollOnce]);

  const stopPolling = useCallback(() => {
    if (pollingTimer.current != null) {
      window.clearInterval(pollingTimer.current);
      pollingTimer.current = null;
    }
  }, []);

  // ---------- snapshot / hydration ----------
  const hydrateFromSnapshot = useCallback(async () => {
    try {
      const s: Snapshot = await getSnapshot(); // ~6s timeout inside analyzer.ts
      if (s.centerHz != null) setCenterMHz(hzToMHz(s.centerHz));
      if (s.spanHz != null) setSpanMHz(hzToMHz(s.spanHz));
      if (s.rbwHz != null) setRbwMHz(hzToMHz(s.rbwHz));
      if (s.vbwHz != null) setVbwMHz(hzToMHz(s.vbwHz));
      if (s.refDbm != null) setRefLevel(s.refDbm);
    } catch (e) {
      console.warn("Snapshot warning:", e);
    }
  }, []);

  // ---------- connect / disconnect ----------
  const handleConnect = useCallback(async () => {
    try {
      const res = await connectAnalyzer(ip, port); // keep your original signature
      if (res?.identity) setIdentity(res.identity);
      setIsConnected(true);
      isConnectedRef.current = true;

      // start drawing immediately (grid shows even before data)
      startRendering();
      startPolling();

      // hydrate sweep settings
      await hydrateFromSnapshot();
    } catch (e) {
      console.error("Connect error:", e);
      setIsConnected(false);
      isConnectedRef.current = false;
    }
  }, [ip, port, startRendering, startPolling, hydrateFromSnapshot]);

  const handleDisconnect = useCallback(async () => {
    stopPolling();
    // keep the last frame on canvas; we keep the render loop running so grid remains visible
    try {
      await disconnectAnalyzer();
    } catch (e) {
      console.warn("Disconnect warning:", e);
    } finally {
      setIsConnected(false);
      isConnectedRef.current = false;
    }
  }, [stopPolling]);

  // ---------- apply sweep ----------
  const handleApplySweep = useCallback(async () => {
    // Pause polling to avoid instrument rejecting changes during transfers
    stopPolling();
    try {
      await configureSweep({
        centerHz: mhzToHz(centerMHz),
        spanHz: mhzToHz(spanMHz),
        rbwHz: mhzToHz(rbwMHz),
        vbwHz: mhzToHz(vbwMHz),
        refDbm: refLevel,
      });
      // re-hydrate in case instrument quantized values
      await hydrateFromSnapshot();
      // clear local max if we’re changing sweep
      clearMax();
    } catch (e) {
      console.error("Sweep update error:", e);
    } finally {
      if (isConnectedRef.current) startPolling();
    }
  }, [centerMHz, spanMHz, rbwMHz, vbwMHz, refLevel, hydrateFromSnapshot, startPolling, stopPolling]);

  // ensure grid visible even when nothing else is happening
  useEffect(() => {
    startRendering();
    return () => stopRendering();
  }, [startRendering, stopRendering]);

  // ---------- UI ----------
  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="text-2xl font-semibold mb-3">RF Automation APP — Spectrum View</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Canvas card (wide) */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="p-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                {isConnected ? (
                  <span>Connected {identity ? `to ${identity}` : ""}</span>
                ) : (
                  <span>Disconnected</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white disabled:opacity-40"
                  onClick={handleConnect}
                  disabled={isConnected}
                >
                  Connect
                </button>
                <button
                  className="px-3 py-1.5 text-sm rounded-md bg-gray-200 text-gray-900 disabled:opacity-40"
                  onClick={handleDisconnect}
                  disabled={!isConnected}
                >
                  Disconnect
                </button>
              </div>
            </div>

            <div className="p-3">
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className="w-full rounded-lg bg-black"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  className={`px-3 py-1.5 text-sm rounded-md ${
                    traceMode === "MAX_HOLD" ? "bg-amber-600 text-white" : "bg-gray-200 text-gray-900"
                  }`}
                  onClick={() =>
                    setTraceMode((m) => (m === "MAX_HOLD" ? "CLEAR_WRITE" : "MAX_HOLD"))
                  }
                >
                  {traceMode === "MAX_HOLD" ? "Max Hold (On)" : "Max Hold"}
                </button>
                <button
                  className="px-3 py-1.5 text-sm rounded-md bg-gray-200 text-gray-900"
                  onClick={clearMax}
                >
                  Clear Max
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Control card */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="p-3 border-b border-gray-100">
            <h2 className="font-medium">Spectrum Controls</h2>
          </div>

          <div className="p-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-600">IP</label>
              <input
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">Port</label>
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value || "0", 10))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Center (MHz)</label>
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={centerMHz}
                onChange={(e) => setCenterMHz(parseFloat(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Span (MHz)</label>
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={spanMHz}
                onChange={(e) => setSpanMHz(parseFloat(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">RBW (MHz)</label>
              <input
                type="number"
                step="0.001"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={rbwMHz}
                onChange={(e) => setRbwMHz(parseFloat(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">VBW (MHz)</label>
              <input
                type="number"
                step="0.001"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={vbwMHz}
                onChange={(e) => setVbwMHz(parseFloat(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">Ref Level (dBm)</label>
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={refLevel}
                onChange={(e) => setRefLevel(parseFloat(e.target.value))}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600">dB / Div</label>
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={dbPerDiv}
                onChange={(e) => setDbPerDiv(parseFloat(e.target.value))}
              />
            </div>

            <div className="col-span-2 flex gap-2 pt-1">
              <button
                className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white disabled:opacity-40"
                onClick={handleApplySweep}
                disabled={!isConnected}
              >
                Apply Sweep
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
