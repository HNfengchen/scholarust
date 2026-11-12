import { useCallback, useEffect, useRef, useState } from "react";
import { modelStatus, ocrModelInfo, ocrStatus, startModel, stopModel } from "../api";
import type { ModelStatus, OcrModelInfo } from "../types";

export interface ModelStatusState {
  status: ModelStatus | null;
  busy: "start" | "stop" | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useModelStatus(
  onError: (message: string) => void,
  enabled = true,
): ModelStatusState {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = () => {
      modelStatus()
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch(() => {
          /* keep previous status */
        });
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  const start = useCallback(async () => {
    setBusy("start");
    try {
      setStatus(await startModel());
    } catch (err) {
      onErrorRef.current(`本地模型启动失败：${String(err)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy("stop");
    try {
      await stopModel();
      setStatus(await modelStatus());
    } catch (err) {
      onErrorRef.current(`本地模型停止失败：${String(err)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  return { status, busy, start, stop };
}

export function modelDotClass(status: ModelStatus | null, busy: "start" | "stop" | null): string {
  if (busy === "start") return "model-dot model-dot-starting";
  if (status?.running) return "model-dot model-dot-running";
  return "model-dot model-dot-stopped";
}

export function modelStateText(status: ModelStatus | null, busy: "start" | "stop" | null): string {
  if (busy === "start") return "启动中…";
  if (busy === "stop") return "停止中…";
  if (status) return status.detail || (status.running ? "运行中" : "已停止");
  return "获取状态中…";
}

export interface OcrModelState {
  info: OcrModelInfo | null;
  status: ModelStatus | null;
  refresh: () => Promise<void>;
}

/** Auto-scanned OCR model pair under `models/ocr` plus its server state. */
export function useOcrModel(): OcrModelState {
  const [info, setInfo] = useState<OcrModelInfo | null>(null);
  const [status, setStatus] = useState<ModelStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const scanned = await ocrModelInfo();
      setInfo(scanned);
      setStatus(await ocrStatus());
    } catch {
      /* keep the previous scan */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { info, status, refresh };
}
