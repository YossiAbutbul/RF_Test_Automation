import React from "react";
import { connectAnalyzer, disconnectAnalyzer, getSnapshot } from "@/api/analyzer";
import { useAppStore } from "@/state/appStore";

type Snapshot = {
  identity?: string;
  centerHz?: number;
  spanHz?: number;
  rbwHz?: number;
  vbwHz?: number;
  refDbm?: number;
};

// helper to trim identity to "Manufacturer Model"
function parseIdentity(full: string | undefined | null): string {
  if (!full) return "";
  const parts = full.split(",");
  if (parts.length >= 2) {
    return `${parts[0].trim()} ${parts[1].trim()}`;
  }
  return full.trim();
}

export default function AnalyzerConnection() {
  const analyzer    = useAppStore((s) => s.analyzer);
  const actions     = useAppStore((s) => s.actions);

  const [ip, setIp]         = React.useState<string>(analyzer.ip || "172.16.10.1");
  const [port, setPort]     = React.useState<string>(analyzer.port || "5555");
  const [model, setModel]   = React.useState<string>(analyzer.model || "");
  const [busy, setBusy]     = React.useState(false);
  const connected           = analyzer.connected;

  React.useEffect(() => {
    setIp(analyzer.ip || "172.16.10.1");
    setPort(analyzer.port || "5555");
    setModel(analyzer.model || "");
  }, [analyzer.ip, analyzer.port, analyzer.model]);

  const hydrateSnapshot = async () => {
    try {
      const snap: Snapshot = await getSnapshot();
      if (snap?.identity) {
        const shortId = parseIdentity(snap.identity);
        setModel(shortId);
        actions.setAnalyzerModel?.(shortId);
      }
    } catch {
      /* non-fatal if snapshot not available */
    }
  };

  const onConnect = async () => {
    setBusy(true);
    try {
      const res = await connectAnalyzer(ip, Number(port));
      const rawIdentity = (res && (res as any).identity) || "";
      const shortId = parseIdentity(rawIdentity);

      if (shortId) {
        setModel(shortId);
        actions.setAnalyzerState?.({ ip, port, model: shortId, connected: true });
      } else {
        await hydrateSnapshot();
        actions.setAnalyzerState?.({ ip, port, connected: true });
      }

      actions.analyzerConnect?.();
    } catch (e) {
      console.error("Analyzer connect failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    try {
      await disconnectAnalyzer();
      setModel("")
      actions.setAnalyzerState?.({ connected: false });
      actions.analyzerDisconnect?.();
    } catch (e) {
      console.error("Analyzer disconnect failed:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="text-base font-medium">Analyzer Connection</div>

      <div className="grid gap-3 mt-4 text-sm">
        {/* Row 1: IP + Port */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="tsq-field-label">IP Address</label>
            <input
              className="tsq-input"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="e.g., 172.16.10.1"
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="tsq-field-label">Port</label>
            <input
              className="tsq-input"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="e.g., 5555"
              type="number"
            />
          </div>
        </div>

        {/* Row 2: Model stretches to the button */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="tsq-field-label">Model</label>
            <input
              className="tsq-input"
              readOnly
              value={model || ""}
              title={model || ""}
            />
          </div>

          {connected ? (
            <button className="tsq-btn ghost" onClick={onDisconnect} disabled={busy}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <button className="tsq-btn primary" onClick={onConnect} disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
