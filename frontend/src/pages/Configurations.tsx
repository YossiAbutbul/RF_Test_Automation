import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import BleScanner from "@/components/ble/BleScanner";
import { useAppStore } from "@/state/appStore";
import { RefreshCw, Trash2, Edit3 } from "lucide-react";
import "./css/Configurations.css";

export default function Configurations() {
  const analyzer = useAppStore((s) => s.analyzer);
  const analyzerConnect = useAppStore((s) => s.actions.analyzerConnect);
  const analyzerDisconnect = useAppStore((s) => s.actions.analyzerDisconnect);

  const anIp = analyzer.ip;
  const anPort = analyzer.port;
  const anModel = analyzer.model ?? "Spectrum Analyzer";
  const anConnected = analyzer.connected;

  return (
    <div className="configurations-page">
      <PageHeader
        title="Configurations"
        subtitle="Manage your test parameters and device settings"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* DUT / BLE Scanner (left, spans 2 columns) */}
        <BleScanner />

        {/* Analyzer Connection (right column) */}
        <Card className="p-4">
          <div className="text-base font-medium">Analyzer Connection</div>

          {/* Optional: small action icons at the top right of the card header */}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button className="tsq-icon-btn" title="Refresh">
              <RefreshCw />
            </button>
            <button className="tsq-icon-btn" title="Edit connection">
              <Edit3 />
            </button>
            <button className="tsq-icon-btn danger" title="Clear settings">
              <Trash2 />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
            <div>
              <label className="tsq-field-label">IP Address</label>
              <input
                className="tsq-input"
                defaultValue={anIp}
                readOnly
              />
            </div>
            <div>
              <label className="tsq-field-label">Port</label>
              <input
                className="tsq-input"
                defaultValue={anPort}
                readOnly
              />
            </div>
            <div>
              <label className="tsq-field-label">Model</label>
              <div className="tsq-input" style={{ display: "flex", alignItems: "center" }}>
                {anModel}
              </div>
            </div>
            
          </div>

          {/* Primary actions — same style as Test Sequence .tsq-btn */}
          <div className="mt-4 flex justify-end gap-2">
            {anConnected ? (
              <button className="tsq-btn ghost" onClick={analyzerDisconnect}>
                Disconnect
              </button>
            ) : (
              <button className="tsq-btn primary" onClick={analyzerConnect}>
                Connect
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
