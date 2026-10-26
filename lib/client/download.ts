/** Browser-only download helpers. jszip is loaded lazily so it never ships with the landing page. */

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function saveBlob(data: Blob | Uint8Array | ArrayBuffer, filename: string, mime = 'application/octet-stream'): void {
  const blob =
    data instanceof Blob
      ? data
      : new Blob(
          [data instanceof Uint8Array ? (data as unknown as BlobPart) : new Uint8Array(data)],
          { type: mime },
        );
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

export function downloadUrlFile(url: string, filename: string): void {
  triggerDownload(url, filename);
}

export interface ZipEntry {
  name: string;
  data: Blob | Uint8Array;
}

function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, '-').trim() || 'converted';
}

export async function saveZip(entries: ZipEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const entry of entries) {
    let name = sanitize(entry.name);
    let counter = 2;
    while (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      name = `${stem}-${counter}${ext}`;
      counter += 1;
    }
    used.add(name.toLowerCase());
    zip.file(name, entry.data);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  saveBlob(blob, `kindleforge-${stamp}.zip`, 'application/zip');
}

export async function fetchAsUint8(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`download ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
