import { invoke } from "@tauri-apps/api/core";

const MAX_IMAGE_EDGE = 1600;

export function normalizeRelativeImageSrc(src: string): string {
  const clean = src.split(/[?#]/)[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

function drawToDataUrl(bitmap: ImageBitmap): string {
  const edge = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, MAX_IMAGE_EDGE / edge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("缺少 2D 画布");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function shrinkBlob(blob: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(blob);
    if (Math.max(bitmap.width, bitmap.height) <= MAX_IMAGE_EDGE) {
      bitmap.close();
      return await readAsDataUrl(blob);
    }
    const dataUrl = drawToDataUrl(bitmap);
    bitmap.close();
    return dataUrl;
  } catch {
    return readAsDataUrl(blob);
  }
}

async function shrinkDataUrl(src: string): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("图片解码失败"));
    element.src = src;
  });
  const edge = Math.max(image.naturalWidth, image.naturalHeight);
  if (edge <= MAX_IMAGE_EDGE) return src;
  const scale = MAX_IMAGE_EDGE / edge;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return src;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// blob:/file-relative sources must become data URLs: the reading cache outlives the reader DOM.
export async function toImageDataUrl(src: string, docId?: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("blob:")) {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return shrinkBlob(await response.blob());
  }
  if (!docId) throw new Error("相对路径图片缺少文档 id");
  const dataUrl = await invoke<string>("read_document_image", {
    id: docId,
    src: normalizeRelativeImageSrc(src),
  });
  try {
    return await shrinkDataUrl(dataUrl);
  } catch {
    return dataUrl;
  }
}
