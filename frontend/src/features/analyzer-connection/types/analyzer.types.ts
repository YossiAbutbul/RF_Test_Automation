// frontend/src/features/analyzer-connection/types/analyzer.types.ts

export interface AnalyzerState {
  ip: string;
  port: string;
  model: string;
  connected: boolean;
}

export interface AnalyzerSnapshot {
  identity?: string;
  centerHz?: number;
  spanHz?: number;
  rbwHz?: number;
  vbwHz?: number;
  refDbm?: number;
}