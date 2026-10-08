'use client';

import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toCsv, type CsvCell } from '@/lib/reports/csv';
import { cn } from '@/lib/utils';

export interface Column<R> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: R) => ReactNode;
  /** Raw value for the CSV (defaults to the rendered text when it is a string/number). */
  csv?: (row: R) => CsvCell;
}

export function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Card with a title, an optional chart, a data table and "Export CSV". */
export function ReportCard({
  title,
  description,
  children,
  className,
  action,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5', className)}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function DataTable<R>({
  caption,
  columns,
  rows,
  csvName,
  empty,
  rowKey,
  collapsible = false,
}: {
  /** Hide the table behind a "Show data table" disclosure (chart cards). */
  collapsible?: boolean;
  caption: string;
  columns: Column<R>[];
  rows: R[];
  csvName: string;
  empty: string;
  rowKey: (row: R, i: number) => string;
}) {
  const t = useT();
  const exportCsv = () => {
    const header = columns.map((c) => c.label);
    const data = rows.map((r) =>
      columns.map((c) => {
        if (c.csv) return c.csv(r);
        const v = c.render(r);
        return typeof v === 'string' || typeof v === 'number' ? v : '';
      }),
    );
    downloadCsv(csvName, toCsv(header, data));
  };
  const exportButton = (
    <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
      <Download className="size-3.5" aria-hidden />
      {t('reports.exportCsv')}
      <span className="sr-only">: {caption}</span>
    </Button>
  );
  const table = (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} scope="col" className={cn('whitespace-nowrap', c.align === 'right' && 'text-right')}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow key={rowKey(r, i)}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn('whitespace-nowrap', c.align === 'right' && 'text-right tabular-nums')}>
                    {c.render(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
  if (collapsible) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex justify-end">{exportButton}</div>
        <details className="min-w-0">
          <summary className="cursor-pointer py-1 text-xs font-medium text-muted-foreground hover:text-foreground">{t('reports.showTable')}</summary>
          <div className="mt-2">{table}</div>
        </details>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex justify-end">{exportButton}</div>
      {table}
    </div>
  );
}
