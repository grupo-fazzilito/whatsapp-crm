'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, ImagePlus, X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './types';

/** A saved image (public URL) or one picked locally and uploaded on save. */
export type ImageItem = { kind: 'url'; url: string } | { kind: 'file'; file: File; preview: string };

export const imageSrc = (i: ImageItem) => (i.kind === 'url' ? i.url : i.preview);

const MAX_IMAGES = 10;

interface Props {
  images: ImageItem[];
  readOnly: boolean;
  onChange: (images: ImageItem[]) => void;
}

export function ImageManager({ images, readOnly, onChange }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  // Release object URLs of local previews when the editor closes.
  const latest = useRef(images);
  useEffect(() => {
    latest.current = images;
  }, [images]);
  useEffect(
    () => () => {
      for (const i of latest.current) if (i.kind === 'file') URL.revokeObjectURL(i.preview);
    },
    [],
  );

  const add = (files: FileList | null) => {
    if (!files) return;
    const next = [...images];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_IMAGES) {
        toast.error(t('catalog.images.tooMany', { max: MAX_IMAGES }));
        break;
      }
      if (!IMAGE_TYPES.includes(file.type)) {
        toast.error(t('catalog.images.badType', { name: file.name }));
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(t('catalog.images.tooBig', { name: file.name }));
        continue;
      }
      next.push({ kind: 'file', file, preview: URL.createObjectURL(file) });
    }
    onChange(next);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length) return;
    const next = [...images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const remove = (idx: number) => {
    const item = images[idx];
    if (item.kind === 'file') URL.revokeObjectURL(item.preview);
    onChange(images.filter((_, i) => i !== idx));
  };

  return (
    <div className="grid gap-2">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((img, idx) => (
          <li key={imageSrc(img)} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc(img)} alt={t('catalog.images.alt', { n: idx + 1 })} className="size-full object-cover" />
            {idx === 0 && (
              <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {t('catalog.images.cover')}
              </span>
            )}
            {!readOnly && (
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1">
                <span className="flex gap-0.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => move(idx, idx - 1)}
                    aria-label={t('catalog.images.moveLeft', { n: idx + 1 })}
                    className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-30"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === images.length - 1}
                    onClick={() => move(idx, idx + 1)}
                    aria-label={t('catalog.images.moveRight', { n: idx + 1 })}
                    className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-30"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  aria-label={t('catalog.images.remove', { n: idx + 1 })}
                  className="rounded p-0.5 text-white hover:bg-white/20"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
          </li>
        ))}
        {!readOnly && images.length < MAX_IMAGES && (
          <li className="aspect-square">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                add(e.dataTransfer.files);
              }}
              className={cn(
                'flex size-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground',
                'hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <ImagePlus className="size-5" />
              {t('catalog.images.add')}
            </button>
          </li>
        )}
      </ul>
      {images.length === 0 && readOnly && <p className="text-sm text-muted-foreground">{t('catalog.images.none')}</p>}
      {!readOnly && <p className="text-xs text-muted-foreground">{t('catalog.images.hint')}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
