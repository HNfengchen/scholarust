import * as api from "../api";

export function normalizeRelativeImageSrc(src: string): string {
  const clean = src.split(/[?#]/)[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader 失败"));
    reader.readAsDataURL(blob);
  });
}

export async function downscaleDataUrl(source: Blob | string): Promise<string> {
  const isBlob = source instanceof Blob;
  const url = isBlob ? URL.createObjectURL(source) : source;
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = url;
    }).catch(async (err) => {
      if (isBlob) return null;
      throw err;
    });
    if (!image) return await blobToDataUrl(source as Blob);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (longest <= 1600) {
      return isBlob ? await blobToDataUrl(source as Blob) : (source as string);
    }
    const scale = 1600 / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 canvas 上下文");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    if (isBlob) URL.revokeObjectURL(url);
  }
}

export async function resolveImage(
  rawSrc: string,
  resolvedSrc: string,
  docId?: string,
): Promise<string> {
  if (rawSrc.startsWith("data:")) return rawSrc;
  if (/^https?:/i.test(rawSrc)) return rawSrc;
  if (resolvedSrc.startsWith("blob:")) {
    const response = await fetch(resolvedSrc);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return downscaleDataUrl(await response.blob());
  }
  if (!docId) throw new Error("缺少文档 id，无法读取相对路径图片");
  const dataUrl = await api.readDocumentImage(docId, normalizeRelativeImageSrc(rawSrc));
  return downscaleDataUrl(dataUrl);
}