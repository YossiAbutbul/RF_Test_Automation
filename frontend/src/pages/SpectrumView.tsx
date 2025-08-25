import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import {
  connectAnalyzer,
  disconnectAnalyzer,
  configureSweep,
  getRawDataCsv,
} from "@/api/analyzer";

/* ===================== Helpers ===================== */

function decimateToWidth(src: number[], width: number): Float32Array {
  const n = src.length;
  if (n <= width) {
    const out = new Float32Array(width);
    for (let i = 0; i < width; i++) {
      const idx = Math.round((i / Math.max(1, width - 1)) * (n - 1));
      out[i] = src[idx];
    }
    return out;
  }
  const out = new Float32Array(width);
  const bucket = n / width;
  let start = 0;
  for (let i = 0; i < width; i++) {
    const end = Math.min(n, Math.round((i + 1) * bucket));
    let sum = 0, cnt = 0;
    for (let j = Math.round(start); j < end; j++) { sum += src[j]; cnt++; }
    out[i] = cnt ? sum / cnt : 0;
    start = end;
  }
  return out;
}

function lerpArrays(prev: Float32Array, next: Float32Array, t: number, out: Float32Array) {
  const len = out.length;
  for (let i = 0; i < len; i++) out[i] = prev[i] + (next[i] - prev[i]) * t;
}

/* ===================== Component ===================== */

export default function SpectrumView() {
  const [tab, setTab] = useState<"Config" | "Markers">("Config");

  // Connection
  const [ip, setIp] = useState("172.16.10.1");
  const [port, setPort] = useState<number>(5555);
  const [isConnected, setIsConnected] = useState(false);
  const isConnectedRef = useRef(isConnected);
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);

  // Sweep configuration (MHz + dBm in UI)
  const [startFreq, setStartFreq] = useState(800);
  const [stopFreq, setStopFreq] = useState(3000);
  const [rbw, setRbw] = useState(1);
  const [vbw, setVbw] = useState(3);
  const [refLevel, setRefLevel] = useState(-20);
  const [dbPerDiv, setDbPerDiv] = useState(10);
  const [detectorType, setDetectorType] = useState<"Peak" | "RMS">("Peak");

  // Canvas + rendering buffers
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevRef = useRef<Float32Array | null>(null);
  const nextRef = useRef<Float32Array | null>(null);
  const workRef = useRef<Float32Array | null>(null);

  // Draw & Polling
  const rafId = useRef<number | null>(null);
  const pollingRef = useRef(false);
  const pollIntervalMsRef = useRef(250);
  const lastServerFrameAt = useRef<number>(performance.now());

  // Sizing
  const sizeRef = useRef<{ w: number; h: number }>({ w: 800, h: 520 });

  /* ---------- Connect/Disconnect ---------- */

  async function handleConnect() {
    try {
      await connectAnalyzer(ip, port);
      isConnectedRef.current = true; // avoid race
      setIsConnected(true);
      startRendering();
      startPolling();
      console.log(`Analyzer connected at ${ip}:${port}`);
    } catch (e) {
      console.error(e);
      alert("Failed to connect to analyzer");
    }
  }

  async function handleDisconnect() {
    // Stop loops first (freeze last frame)
    stopPolling();
    stopRendering();
    try {
      await disconnectAnalyzer();
    } catch (e) {
      console.warn("Disconnect warning:", e);
    } finally {
      setIsConnected(false);
      isConnectedRef.current = false;
      // Freeze on last frame: do not clear canvas or buffers
    }
  }

  /* ---------- Apply Config ---------- */

  async function handleUpdateSweep() {
    if (!isConnectedRef.current) { alert("Connect first"); return; }
    const wasPolling = pollingRef.current;
    if (wasPolling) stopPolling();
    try {
      const centerHz = ((startFreq + stopFreq) / 2) * 1e6;
      const spanHz   = (stopFreq - startFreq) * 1e6;
      const rbwHz    = rbw * 1e6;
      const vbwHz    = vbw * 1e6;
      await configureSweep({ centerHz, spanHz, rbwHz, vbwHz, refDbm: refLevel });
    } catch (e) {
      console.error(e);
      alert("Failed to apply configuration");
    } finally {
      if (isConnectedRef.current && wasPolling) startPolling();
    }
  }

  /* ---------- Polling: sequential, no overlap ---------- */

  async function pollOnce() {
    try {
      const csv = await getRawDataCsv(); // throws "not-connected" on 204/empty
      if (!isConnectedRef.current || !pollingRef.current) return;

      const arr = csv
        .trim()
        .split(",")
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n));

      if (arr.length === 0) return;

      const width = sizeRef.current.w;
      const dec = decimateToWidth(arr, width);

      if (!prevRef.current || prevRef.current.length !== width) prevRef.current = new Float32Array(dec);
      if (!nextRef.current || nextRef.current.length !== width) nextRef.current = new Float32Array(dec);
      if (!workRef.current || workRef.current.length !== width) workRef.current = new Float32Array(width);

      prevRef.current.set(nextRef.current);
      nextRef.current.set(dec);
      lastServerFrameAt.current = performance.now();
    } catch (e: any) {
      // Stop polling cleanly when backend says "not connected"
      if (typeof e?.message === "string" && e.message.startsWith("not-connected")) {
        stopPolling();
        return;
      }
      // swallow other transient errors (reconfig races, brief network hiccups)
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
    loop();
  }

  function stopPolling() {
    pollingRef.current = false;
  }

  /* ---------- Drawing loop ---------- */

  function startRendering() {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;

      const prev = prevRef.current;
      const next = nextRef.current;
      const work = workRef.current;

      // grid
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawGrid(ctx, w, h);

      if (prev && next && work) {
        const elapsed = performance.now() - lastServerFrameAt.current;
        const t = Math.min(1, elapsed / pollIntervalMsRef.current);
        lerpArrays(prev, next, t, work);

        const top = refLevel;
        const bottom = refLevel - dbPerDiv * 10;
        const fullSpan = Math.max(1e-6, top - bottom);

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#4ade80";
        ctx.beginPath();
        for (let i = 0; i < work.length; i++) {
          const x = (i / (work.length - 1)) * w;
          const v = work[i]; // dBm
          const ratio = (top - v) / fullSpan;
          const y = Math.min(h, Math.max(0, ratio * h));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      rafId.current = requestAnimationFrame(draw);
    };

    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(draw);
  }

  function stopRendering() {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = null;
    // freeze last frame
  }

  /* ---------- Grid drawing helpers ---------- */

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(99, 102, 241, 0.08)");
    grad.addColorStop(1, "rgba(99, 102, 241, 0.02)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const divisions = 10;
    ctx.lineWidth = 1;

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

    for (let i = 0; i <= divisions; i++) {
      const x = (i / divisions) * w;
      ctx.strokeStyle = i === 0 || i === divisions ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.1)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  function drawStaticGrid() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, w, h);
  }

  /* ---------- Canvas sizing ---------- */

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      sizeRef.current = {
        w: Math.max(200, Math.round(rect.width)),
        h: Math.max(200, Math.round(rect.height)),
      };
      const width = sizeRef.current.w;
      prevRef.current = new Float32Array(width);
      nextRef.current = new Float32Array(width);
      workRef.current = new Float32Array(width);

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(sizeRef.current.h * dpr);

      drawStaticGrid();
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
            className="rounded-xl bg-green-600 text-white px-3 py-1 text-xs"
            disabled={!ip}
          >
            Connect
          </button>
        )}
      </div>

      {/* Status row */}
      <div className="flex items-center gap-3 mb-3 text-xs text-zinc-600">
        <div className="flex items-center gap-2">
          <span className="font-medium">Ref Level:</span>
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
              <option key={v} value={v}>{v}</option>
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
            <div className="space-y-3">
              <div>
                <div className="text-xs text-zinc-500">Start Freq (MHz)</div>
                <input
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                  type="number"
                  value={startFreq}
                  onChange={(e) => setStartFreq(Number(e.target.value))}
                />
              </div>
              <div>
                <div className="text-xs text-zinc-500">Stop Freq (MHz)</div>
                <input
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                  type="number"
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
                    value={rbw}
                    onChange={(e) => setRbw(Number(e.target.value))}
                  />
                </div>
                <div>
                  <div className="text-xs text-zinc-500">VBW (MHz)</div>
                  <input
                    className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                    type="number"
                    value={vbw}
                    onChange={(e) => setVbw(Number(e.target.value))}
                  />
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Reference Level (dBm)</div>
                <input
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                  type="number"
                  value={refLevel}
                  onChange={(e) => setRefLevel(Number(e.target.value))}
                />
              </div>
              <div>
                <div className="text-xs text-zinc-500">Detector Type</div>
                <select
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                  value={detectorType}
                  onChange={(e) => setDetectorType(e.target.value as "Peak" | "RMS")}
                >
                  <option value="Peak">Peak</option>
                  <option value="RMS">RMS</option>
                </select>
              </div>

              <button onClick={handleUpdateSweep} className="rounded-xl bg-[#6B77F7] text-white w-full py-2" disabled={!isConnected}>
                Update Sweep
              </button>

              <div className="pt-2">
                <div className="text-sm font-medium">Display Options</div>
                <label className="flex items-center justify-between pt-2 text-sm">
                  Max Hold <input type="checkbox" />
                </label>
                <label className="flex items-center justify-between pt-2 text-sm">
                  Delta Mode <input type="checkbox" />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-medium">Markers</div>
              <div>
                <div className="text-xs text-zinc-500">Add Marker at Frequency (MHz)</div>
                <div className="flex gap-2 mt-1">
                  <input className="w-full rounded-xl border px-3 py-2 bg-white" placeholder="MHz" />
                  <button className="px-3 py-2 rounded-xl border">+</button>
                </div>
              </div>
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
