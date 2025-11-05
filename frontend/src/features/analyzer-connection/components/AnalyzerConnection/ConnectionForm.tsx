// frontend/src/features/analyzer-connection/components/AnalyzerConnection/ConnectionForm.tsx

interface ConnectionFormProps {
  ip: string;
  port: string;
  model: string;
  connected: boolean;
  busy: boolean;
  onIpChange: (ip: string) => void;
  onPortChange: (port: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function ConnectionForm({
  ip,
  port,
  model,
  connected,
  busy,
  onIpChange,
  onPortChange,
  onConnect,
  onDisconnect,
}: ConnectionFormProps) {
  return (
    <div className="grid gap-3 mt-4 text-sm">
      {/* Row 1: IP + Port */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="tsq-field-label">IP Address</label>
          <input
            className="tsq-input"
            value={ip}
            onChange={(e) => onIpChange(e.target.value)}
            placeholder="e.g., 172.16.10.1"
            inputMode="decimal"
            disabled={connected}
          />
        </div>
        <div>
          <label className="tsq-field-label">Port</label>
          <input
            className="tsq-input"
            value={port}
            onChange={(e) => onPortChange(e.target.value)}
            placeholder="e.g., 5555"
            type="number"
            disabled={connected}
          />
        </div>
      </div>

      {/* Row 2: Model + Connect Button */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="tsq-field-label">Model</label>
          <input
            className="tsq-input"
            readOnly
            value={model || ""}
            title={model || ""}
            placeholder="Will be detected on connect"
          />
        </div>

        {connected ? (
          <button
            className="tsq-btn ghost"
            onClick={onDisconnect}
            disabled={busy}
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <button
            className="tsq-btn primary"
            onClick={onConnect}
            disabled={busy}
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}