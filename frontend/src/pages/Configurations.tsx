import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import BleScanner from "@/components/ble/BleScanner";
import AnalyzerConnection from "@/components/analyzer/AnalyzerConnection";
import { useAppStore } from "@/state/appStore";
import { RefreshCw, Trash2, Edit3 } from "lucide-react";
import "./css/Configurations.css";

export default function Configurations() {
  const analyzer = useAppStore((s) => s.analyzer);
  const analyzerConnect = useAppStore((s) => s.actions.analyzerConnect);
  const analyzerDisconnect = useAppStore((s) => s.actions.analyzerDisconnect);

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
        <AnalyzerConnection />
      </div>
    </div>
  );
}
