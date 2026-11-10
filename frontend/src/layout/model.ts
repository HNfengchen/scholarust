import * as ort from "onnxruntime-web";
import { detectionToBox, letterboxGeometry, parseDetections } from "./geometry";
import { MODEL_INPUT_SIZE, MODEL_PAD_VALUE } from "./types";
import type { LayoutBox, Letterbox } from "./types";

let sessionPromise: Promise<ort.InferenceSession> | null = null;

export function loadLayoutSession(modelUrl: string): Promise<ort.InferenceSession> {
  sessionPromise ??= (async () => {
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = true;
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`模型下载失败：HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    return ort.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: ["wasm"],
    });
  })();
  sessionPromise.catch(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

export async function runLayoutOnCanvas(
  session: ort.InferenceSession,
  canvas: HTMLCanvasElement,
): Promise<{ detections: LayoutBox[]; geometry: Letterbox }> {
  const geometry = letterboxGeometry(canvas.width, canvas.height);
  const input = document.createElement("canvas");
  input.width = MODEL_INPUT_SIZE;
  input.height = MODEL_INPUT_SIZE;
  const context = input.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法创建 canvas 上下文");
  context.fillStyle = `rgb(${MODEL_PAD_VALUE},${MODEL_PAD_VALUE},${MODEL_PAD_VALUE})`;
  context.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  context.drawImage(canvas, geometry.padX, geometry.padY, geometry.drawW, geometry.drawH);
  const { data } = context.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const pixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const chw = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    chw[i] = data[i * 4] / 255;
    chw[pixels + i] = data[i * 4 + 1] / 255;
    chw[2 * pixels + i] = data[i * 4 + 2] / 255;
  }
  const tensor = new ort.Tensor("float32", chw, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const output = results[session.outputNames[0]];
  const count = output.dims.length === 3 ? output.dims[1] : Math.floor(output.size / 6);
  const detections = parseDetections(output.data as Float32Array, count).map((det) =>
    detectionToBox(det, geometry, canvas.width, canvas.height),
  );
  input.width = 0;
  input.height = 0;
  return { detections, geometry };
}