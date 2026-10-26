import { AlertTriangle, Download, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/client/estimate';
import type { ConversionOutput, FileItem } from '@/lib/client/types';

export function ResultCard({
  item,
  result,
  labels,
  onDownload,
}: {
  item: FileItem;
  result: ConversionOutput;
  labels: { download: string; engine: string; warnings: string; localBadge: string };
  onDownload: () => void;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-moss-500/25 bg-moss-500/[0.06] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-paper" title={result.filename}>
            {result.filename}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-paper-dim/80">
            <span>{formatBytes(result.size)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {labels.engine}: {result.engine}
            </span>
            {item.mode === 'local' ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 text-moss-400">
                  <HardDrive aria-hidden="true" className="h-3 w-3" />
                  {labels.localBadge}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <Button size="sm" onClick={onDownload} className="shrink-0">
          <Download aria-hidden="true" className="h-4 w-4" />
          {labels.download}
        </Button>
      </div>

      {result.warnings.length > 0 ? (
        <div className="mt-3 rounded-xl border border-clay/25 bg-clay/[0.06] p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-clay">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            {labels.warnings}
          </p>
          <ul className="mt-1 space-y-1 pl-5 text-[11px] leading-5 text-paper-dim">
            {result.warnings.map((warning) => (
              <li key={warning} className="list-disc">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
