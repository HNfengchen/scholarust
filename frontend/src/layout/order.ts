export interface OrderBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function largestGap(intervals: [number, number][]): { mid: number; gap: number } | null {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let best: { mid: number; gap: number } | null = null;
  let end = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [start, stop] = sorted[i];
    if (start > end) {
      const gap = start - end;
      if (!best || gap > best.gap) best = { mid: (end + start) / 2, gap };
    }
    end = Math.max(end, stop);
  }
  return best;
}

export function orderBoxes<T extends OrderBox>(
  boxes: T[],
  pageWidth: number,
  pageHeight: number,
): T[] {
  if (boxes.length <= 1) return [...boxes];
  const byPosition = () => [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);

  const xGap = largestGap(boxes.map((b) => [b.x, b.x + b.w]));
  if (xGap && xGap.gap >= pageWidth * 0.04) {
    const left = boxes.filter((b) => b.x + b.w <= xGap.mid);
    const right = boxes.filter((b) => b.x >= xGap.mid);
    if (left.length > 0 && right.length > 0 && left.length + right.length === boxes.length) {
      return [
        ...orderBoxes(left, pageWidth, pageHeight),
        ...orderBoxes(right, pageWidth, pageHeight),
      ];
    }
  }

  const yGap = largestGap(boxes.map((b) => [b.y, b.y + b.h]));
  if (yGap && yGap.gap >= pageHeight * 0.03) {
    const top = boxes.filter((b) => b.y + b.h <= yGap.mid);
    const bottom = boxes.filter((b) => b.y >= yGap.mid);
    if (top.length > 0 && bottom.length > 0 && top.length + bottom.length === boxes.length) {
      return [
        ...orderBoxes(top, pageWidth, pageHeight),
        ...orderBoxes(bottom, pageWidth, pageHeight),
      ];
    }
  }

  return byPosition();
}