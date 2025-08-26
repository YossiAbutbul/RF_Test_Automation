import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import {
  ping,
  connectAnalyzer,
  disconnectAnalyzer,
  configureSweep,
  getRawDataCsv,
  getSnapshot,
} from "@/api/analyzer";

/* ===================== Helpers ===================== */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decimateToWidth(src: number[], width: number): Float32Array {
  const n = src.length;
  if (n <= width) {
    const out = new Float32Array(width);
    for (let i = 0; i < width; i++) {
      const idx = Math.round((i / Math.max(1, width - 1)) * (n - 1));
      out[i] = src[idx] ?? src[n - 1] ?? 0;
    }
    return out;
  }
  const out = new Float32Array(width);
  const bucket = n / width;
  let start = 0;
  for (let i = 0; i < width; i++) {
    const end = Math.min(n, Math.round((i + 1) * bucket));
    let sum = 0,
      cnt = 0;
    for (let j = Math.round(start); j < end; j++) {
      sum += src[j];
      cnt++;
    }
    out[i] = cnt ? sum / cnt : 0;
    start = end;
  }
  return out;
}

function lerpArrays(prev: Float32Array, next: Float32Array, t: number, out: Float32Array) {
  const len = out.length;
  for (let i = 0; i < len; i++) out[i] = prev[i] + (next[i] - prev[i]) * t;
}

type TraceMode = "CLEAR_WRITE" | "MAX_HOLD";

/* ===================== Component ===================== */

export default function SpectrumView() {
  const [tab, setTab] = useState<"Config" | "Markers">("Config");

  // Connection
  const [ip, setIp] = useState("172.16.10.1");
  const [port, setPort] = useState<number>(5555);
  const [isConnected, setIsConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const isConnectedRef = useRef(isConnected);
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  // Sweep configuration (MHz + dBm in UI)
  const [startFreq, setStartFreq] = useState(800); // MHz
  const [stopFreq, setStopFreq] = useState(3000); // MHz
  const [rbw, setRbw] = useState(1); // MHz
  const [vbw, setVbw] = useState(3); // MHz
  const [refLevel, setRefLevel] = useState(-20); // dBm
  const [dbPerDiv, setDbPerDiv] = useState(10); // dB/div

  // Trace mode
  const [traceMode, setTraceMode] = useState<TraceMode>("CLEAR_WRITE");

  // Canvas + rendering buffers
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevRef = useRef<Float32Array | null>(null);
  const nextRef = useRef<Float32Array | null>(null);
  const workRef = useRef<Float32Array | null>(null);
  const holdRef = useRef<Float32Array | null>(null); // Max Hold buffer

  // Draw & Polling
  const rafId = useRef<number | null>(null);
  const pollingRef = useRef(false);
  const pollIntervalMsRef = useRef(90); // snappy updates
  const lastServerFrameAt = useRef<number>(performance.now());

  // Sizing
  const sizeRef = useRef<{ w: number; h: number }>({ w: 800, h: 520 });

  /* ---------- Connect / Disconnect ---------- */

  async function hydrateFromInstrument() {
    try {
      const snap = await getSnapshot(); // one request, 6s timeout in api layer
      if (typeof snap.refDbm === "number") setRefLevel(snap.refDbm);
      if (typeof snap.rbwHz === "number") setRbw(snap.rbwHz / 1e6);
      if (typeof snap.vbwHz === "number") setVbw(snap.vbwHz / 1e6);
      if (typeof snap.centerHz === "number" && typeof snap.spanHz === "number") {
        const startMHz = (snap.centerHz - snap.spanHz / 2) / 1e6;
        const stopMHz = (snap.centerHz + snap.spanHz / 2) / 1e6;
        setStartFreq(Number(startMHz.toFixed(3)));
        setStopFreq(Number(stopMHz.toFixed(3)));
      }
    } catch (e) {
      console.warn("Hydrate warning:", e);
    }
  }

  async function handleConnect() {
    if (connecting || isConnectedRef.current) return;
    console.log("Connect clicked", { ip, port });

    setConnecting(true);
    try {
      const ok = await ping();
      if (!ok) {
        alert("Backend not reachable (open http://127.0.0.1:8000 to verify).");
        return;
      }

      await connectAnalyzer(ip, port);
      isConnectedRef.current = true;
      setIsConnected(true);

      // FAST first paint
      startRendering();
      startPolling();

      // Hydrate (non-blocking)
      hydrateFromInstrument().catch((e) => console.warn("Hydrate warning:", e));

      console.log(`Connected to analyzer at ${ip}:${port}`);
    } catch (e) {
      console.error("Connect error:", e);
      alert("Failed to connect to analyzer");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    stopPolling();   // freeze last frame
    stopRendering(); // keep canvas as-is
    try {
      await disconnectAnalyzer();
    } catch (e) {
      console.warn("Disconnect warning:", e);
    } finally {
      setIsConnected(false);
      isConnectedRef.current = false;
      console.log("Disconnected");
    }
  }

  /* ---------- Apply Config ---------- */

  function clampRefLevel(x: number) {
    if (!Number.isFinite(x)) return refLevel;
    return Math.max(-150, Math.min(30, x)); // allow negatives; clamp to safe range
  }

  async function handleUpdateSweep() {
    if (!isConnectedRef.current) {
      alert("Connect first");
      return;
    }
    const wasPolling = pollingRef.current;
    if (wasPolling) stopPolling(); // avoid “unable to update sweep”

    try {
      const centerHz = ((startFreq + stopFreq) / 2) * 1e6;
      const spanHz = (stopFreq - startFreq) * 1e6;
      const rbwHz = rbw * 1e6;
      const vbwHz = vbw * 1e6;
      const refDbm = clampRefLevel(refLevel);

      await configureSweep({ centerHz, spanHz, rbwHz, vbwHz, refDbm });
      await sleep(120); // let instrument settle

      if (traceMode === "MAX_HOLD") clearMaxHold(); // optional: reset hold
      console.log("Sweep updated");
    } catch (e) {
      console.error("Update sweep error:", e);
      alert("Unable to update sweep");
    } finally {
      if (isConnectedRef.current && wasPolling) startPolling();
    }
  }

  /* ---------- Polling: sequential, no overlap ---------- */

  async function pollOnce() {
    try {
      const csv = await getRawDataCsv(); // 2s timeout, throws "empty" if no data
      if (!isConnectedRef.current || !pollingRef.current) return;

      const arr = csv
        .split(",")
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n));
      if (!arr.length) return;

      const width = sizeRef.current.w;
      const dec = decimateToWidth(arr, width);

      if (!prevRef.current || prevRef.current.length !== width) prevRef.current = new Float32Array(dec);
      if (!nextRef.current || nextRef.current.length !== width) nextRef.current = new Float32Array(dec);
      if (!workRef.current || workRef.current.length !== width) workRef.current = new Float32Array(width);
      if (!holdRef.current || holdRef.current.length !== width) {
        holdRef.current = new Float32Array(width);
        holdRef.current.fill(-1e9);
      }

      prevRef.current.set(nextRef.current);
      nextRef.current.set(dec);

      if (traceMode === "MAX_HOLD" && holdRef.current) {
        const h = holdRef.current;
        for (let i = 0; i < dec.length; i++) if (dec[i] > h[i]) h[i] = dec[i];
      }

      lastServerFrameAt.current = performance.now();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.startsWith("not-connected")) {
        // stop polling but DO NOT flip isConnected; user can reconnect
        pollingRef.current = false;
        return;
      }
      // timeout/server-error/empty -> ignore, keep UI live
    }
  }

  function startPolling() {
    if (pollingRef.current) return;
    pollingRef.current = true;

    const loop = async () => {
      if (!pollingRef.current || !isConnectedRef.current) return;
      await pollOnce();
      if (!pollingRef.current || !isConnectedRef.current) return;
      setTimeout(loop, pollIntervalMsRef.current);
    };

    // immediate first poll
    pollOnce().finally(() => setTimeout(loop, pollIntervalMsRef.current));
  }

  function stopPolling() {
    pollingRef.current = false;
  }

  /* ---------- Drawing loop ---------- */

  function startRendering() {
    // mark as if we just received a frame so first draw doesn't lag
    lastServerFrameAt.current = performance.now();

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;

      // grid
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawGrid(ctx, w, h);

      const prev = prevRef.current;
      const next = nextRef.current;
      const work = workRef.current;

      if (prev && next && work) {
        const elapsed = performance.now() - lastServerFrameAt.current;
        const t = Math.min(1, elapsed / pollIntervalMsRef.current);
        lerpArrays(prev, next, t, work);

        const top = refLevel;
        const bottom = refLevel - dbPerDiv * 10;
        const fullSpan = Math.max(1e-6, top - bottom);

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#22c55e";
        ctx.beginPath();
        for (let i = 0; i < work.length; i++) {
          const x = (i / (work.length - 1)) * w;
          const v = work[i];
          const ratio = (top - v) / fullSpan;
          const y = Math.min(h, Math.max(0, ratio * h));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        if (traceMode === "MAX_HOLD" && holdRef.current) {
          const hold = holdRef.current;
          ctx.lineWidth = 1;
          ctx.strokeStyle = "#6b21a8";
          ctx.beginPath();
          for (let i = 0; i < hold.length; i++) {
            const x = (i / (hold.length - 1)) * w;
            const v = hold[i];
            const ratio = (top - v) / fullSpan;
            const y = Math.min(h, Math.max(0, ratio * h));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      rafId.current = requestAnimationFrame(draw);
    };

    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(draw);
  }

  function stopRendering() {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = null;
    // Do not clear canvas → freeze last frame
  }

  /* ---------- Grid & canvas init ---------- */

  function clearMaxHold() {
    if (holdRef.current) holdRef.current.fill(-1e9);
  }

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    // background
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(99, 102, 241, 0.08)");
    grad.addColorStop(1, "rgba(99, 102, 241, 0.02)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 10x10 grid
    const divisions = 10;
    ctx.lineWidth = 1;

    // horizontal lines + labels
    for (let i = 0; i <= divisions; i++) {
      const y = (i / divisions) * h;
      ctx.strokeStyle = i === 0 || i === divisions ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.1)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      const labelDbm = refLevel - i * dbPerDiv;
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
        ctx.textBaseline = "middle";
        ctx.fillText(`${labelDbm} dBm`, 6, Math.min(h - 10, Math.max(10, y)));
      }
    }

    // vertical lines
    for (let i = 0; i <= divisions; i++) {
      const x = (i / divisions) * w;
      ctx.strokeStyle = i === 0 || i === divisions ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.1)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  function initCanvasAndGrid() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // size
    const rect = canvas.getBoundingClientRect();
    sizeRef.current = {
      w: Math.max(200, Math.round(rect.width || 800)),
      h: Math.max(200, Math.round(rect.height || 520)),
    };

    // DPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(sizeRef.current.w * dpr);
    canvas.height = Math.round(sizeRef.current.h * dpr);

    // first grid paint (so you see the skeleton before connecting)
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
      drawGrid(ctx, sizeRef.current.w, sizeRef.current.h);
    }
  }

  /* ---------- Canvas sizing & initial grid ---------- */

  useEffect(() => {
    initCanvasAndGrid();

    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      sizeRef.current = {
        w: Math.max(200, Math.round(rect.width)),
        h: Math.max(200, Math.round(rect.height)),
      };

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(sizeRef.current.w * dpr);
      canvas.height = Math.round(sizeRef.current.h * dpr);

      // repaint static grid on resize
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
        drawGrid(ctx, sizeRef.current.w, sizeRef.current.h);
      }

      // (re)allocate buffers to new width
      const width = sizeRef.current.w;
      prevRef.current = new Float32Array(width);
      nextRef.current = new Float32Array(width);
      workRef.current = new Float32Array(width);
      holdRef.current = new Float32Array(width);
      holdRef.current.fill(-1e9);
    });

    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  /* ---------- Cleanup ---------- */

  useEffect(() => {
    return () => {
      stopPolling();
      stopRendering();
    };
  }, []);

  /* ===================== Render ===================== */

  return (
    <div>
      <PageHeader title="Spectrum View" subtitle="Analyze real-time frequency domain data" />

      {/* Connection Controls */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="Analyzer IP"
          className="rounded-xl border px-3 py-1 text-sm w-44"
        />
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
          className="rounded-xl border px-3 py-1 text-sm w-24"
        />
        {isConnected ? (
          <button onClick={handleDisconnect} className="rounded-xl bg-red-500 text-white px-3 py-1 text-xs">
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            className={`rounded-xl ${connecting ? "bg-zinc-400" : "bg-green-600"} text-white px-3 py-1 text-xs`}
            disabled={!ip || connecting}
            title={connecting ? "Connecting..." : "Connect to analyzer"}
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>

      {/* Status row + Trace mode indicator */}
      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-zinc-700">
        <span className="px-2 py-1 rounded-full border">
          Trace: {traceMode === "MAX_HOLD" ? "Max Hold" : "Clear/Write"}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-medium">Ref:</span>
          <span>{refLevel} dBm</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">dB/Div:</span>
          <select
            className="rounded-lg border px-2 py-1"
            value={dbPerDiv}
            onChange={(e) => setDbPerDiv(Number(e.target.value))}
          >
            {[1, 2, 5, 10].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-4">
        <Card className="p-4">
          <div className="font-medium">Spectrum Analysis</div>
          <div className="text-sm text-zinc-500">Real-time frequency domain monitoring</div>
          <canvas
            ref={canvasRef}
            className="mt-3 w-full h-[520px] rounded-xl border bg-gradient-to-b from-blue-50 to-blue-100/30"
          />
        </Card>

        <Card className="p-4 w-full">
          <div className="flex items-center gap-3 text-sm mb-3">
            {(["Config", "Markers"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 rounded-full border ${
                  tab === t ? "bg-white shadow" : "bg-zinc-50 border-transparent"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "Config" ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                handleUpdateSweep();
              }}
            >
              <div>
                <div className="text-xs text-zinc-500">Start Freq (MHz)</div>
                <input
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                  type="number"
                  step="any"
                  value={startFreq}
                  onChange={(e) => setStartFreq(Number(e.target.value))}
                />
              </div>
              <div>
                <div className="text-xs text-zinc-500">Stop Freq (MHz)</div>
                <input
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                  type="number"
                  step="any"
                  value={stopFreq}
                  onChange={(e) => setStopFreq(Number(e.target.value))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-zinc-500">RBW (MHz)</div>
                  <input
                    className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                    type="number"
                    step="any"
                    value={rbw}
                    onChange={(e) => setRbw(Number(e.target.value))}
                  />
                </div>
                <div>
                  <div className="text-xs text-zinc-500">VBW (MHz)</div>
                  <input
                    className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                    type="number"
                    step="any"
                    value={vbw}
                    onChange={(e) => setVbw(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-[1fr,auto,auto] gap-3 items-end">
                <div>
                  <div className="text-xs text-zinc-500">Reference Level (dBm)</div>
                  <input
                    className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                    type="number"
                    step="any"
                    value={refLevel}
                    onChange={(e) => setRefLevel(Number(e.target.value))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-zinc-500">Max Hold</label>
                  <input
                    type="checkbox"
                    checked={traceMode === "MAX_HOLD"}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setTraceMode(on ? "MAX_HOLD" : "CLEAR_WRITE");
                      if (on) {
                        if (holdRef.current && nextRef.current) holdRef.current.set(nextRef.current);
                      }
                    }}
                  />
                </div>
                <button type="button" className="rounded-xl border px-3 py-2 text-xs" onClick={clearMaxHold}>
                  Clear Max
                </button>
              </div>

              <button
                type="submit"
                className="rounded-xl bg-[#6B77F7] text-white w-full py-2"
                disabled={!isConnected}
                title="Press Enter to apply"
              >
                Update Sweep (Enter)
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-medium">Markers</div>
              <div className="rounded-xl border border-dashed p-6 text-sm text-zinc-500 grid place-items-center">
                No markers added
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
