// frontend/src/features/analyzer-connection/components/AnalyzerConnection/index.tsx

import React from "react";
import { connectAnalyzer, disconnectAnalyzer, getSnapshot } from "@/api/analyzer";
import { useAppStore } from "@/state/appStore";
import { parseIdentity } from "../../utils/identityParser";
import type { AnalyzerSnapshot } from "../../types/analyzer.types";
import ConnectionForm from "./ConnectionForm";

export default function AnalyzerConnection() {
  const analyzer = useAppStore((s) => s.analyzer);
  const actions = useAppStore((s) => s.actions);

  const [ip, setIp] = React.useState<string>(analyzer.ip || "172.16.10.1");
  const [port, setPort] = React.useState<string>(analyzer.port || "5555");
  const [model, setModel] = React.useState<string>(analyzer.model || "");
  const [busy, setBusy] = React.useState(false);

  const connected = analyzer.connected;

  // Sync local state with store
  React.useEffect(() => {
    setIp(analyzer.ip || "172.16.10.1");
    setPort(analyzer.port || "5555");
    setModel(analyzer.model || "");
  }, [analyzer.ip, analyzer.port, analyzer.model]);

  const hydrateSnapshot = async () => {
    try {
      const snap: AnalyzerSnapshot = await getSnapshot();
      if (snap?.identity) {
        const shortId = parseIdentity(snap.identity);
        setModel(shortId);
        actions.setAnalyzerModel?.(shortId);
      }
    } catch {
      // Non-fatal if snapshot not available
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
      setModel("");
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

      <ConnectionForm
        ip={ip}
        port={port}
        model={model}
        connected={connected}
        busy={busy}
        onIpChange={setIp}
        onPortChange={setPort}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />
    </div>
  );
}