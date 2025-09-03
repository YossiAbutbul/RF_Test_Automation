// src/api/tests.ts

/** Generic SSE event types */
export type SSEvent =
  | { type: "start"; test: string; params: Record<string, any> }
  | { type: "step"; key: string; status: "start" | "done" | "error"; message?: string; measuredDbm?: number }
  | { type: "log"; message: string }
  | { type: "result"; measuredDbm?: number; pass_?: boolean | null }
  | { type: "error"; error: string }
  | { type: "done"; ok: boolean };

export type SSEHandlers = Partial<{
  onEvent: (e: SSEvent) => void;
  onStart: (e: Extract<SSEvent, { type: "start" }>) => void;
  onStep: (e: Extract<SSEvent, { type: "step" }>) => void;
  onLog: (e: Extract<SSEvent, { type: "log" }>) => void;
  onResult: (e: Extract<SSEvent, { type: "result" }>) => void;
  onError: (e: Extract<SSEvent, { type: "error" }>) => void;
  onDone: (e: Extract<SSEvent, { type: "done" }>) => void;
}>;

const BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function route(data: SSEvent, h: SSEHandlers) {
  h.onEvent?.(data);
  switch (data.type) {
    case "start": h.onStart?.(data); break;
    case "step": h.onStep?.(data); break;
    case "log": h.onLog?.(data); break;
    case "result": h.onResult?.(data); break;
    case "error": h.onError?.(data); break;
    case "done": h.onDone?.(data); break;
  }
}

function listen(es: EventSource, h: SSEHandlers) {
  ["start", "step", "log", "result", "error", "done"].forEach((name) => {
    es.addEventListener(name, (raw: MessageEvent) => {
      try { route(JSON.parse(raw.data) as SSEvent, h); } catch {}
    });
  });
  es.onmessage = (raw) => { try { route(JSON.parse(raw.data) as SSEvent, h); } catch {} };
}

export function openTestStream(endpointPath: string, params: Record<string, any>, handlers: SSEHandlers = {}): EventSource {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v != null) q.set(k, String(v)); });
  const es = new EventSource(`${BASE}${endpointPath}?${q.toString()}`);
  listen(es, handlers);
  return es;
}
