// Shared SSE event types & runner handlers (kept permissive to match your backend)
export type StepEvt = {
  type: "step";
  key: "connectAnalyzer" | "configureAnalyzer" | "connectDut" | "cwOn" | "measure" | "cwOff" | "close";
  status: "start" | "done" | "error";
  message?: string;
  measuredDbm?: number;
  measuredHz?: number;
  errorHz?: number;
  errorPpm?: number;
  pass_?: boolean | null;
};
export type ResultEvt = {
  type: "result";
  measuredDbm?: number;
  measuredHz?: number;
  errorHz?: number;
  errorPpm?: number;
  pass_?: boolean | null;
};
export type LogEvt = { type: "log"; message: string };
export type StartEvt = { type: "start"; test: string; params: any };
export type ErrEvt = { type: "error"; error: string };
export type DoneEvt = { type: "done"; ok: boolean };
export type AnyEvt = StepEvt | ResultEvt | LogEvt | StartEvt | ErrEvt | DoneEvt | Record<string, any>;

export type SSEHandlers = {
  onStart?: (e: AnyEvt) => void;
  onStep?: (e: AnyEvt) => void;
  onLog?: (e: AnyEvt) => void;
  onResult?: (e: AnyEvt) => void;
  onError?: (e: AnyEvt) => void;
  onDone?: () => void;
};
