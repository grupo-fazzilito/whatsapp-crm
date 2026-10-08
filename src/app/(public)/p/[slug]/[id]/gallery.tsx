'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';

interface Props {
  images: string[];
  name: string;
  labels: { gallery: string; prev: string; next: string; photo: string; noPhotos: string };
}

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

/** Photo gallery: main photo with prev/next and a thumbnail strip. Print shows a grid. */
export function Gallery({ images, name, labels }: Props) {
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLUListElement>(null);
  const total = images.length;

  if (!total) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-slate-100 text-slate-500 sm:aspect-[16/9]">
        <ImageOff className="size-10" aria-hidden />
        <span className="sr-only">{labels.noPhotos}</span>
      </div>
    );
  }

  const go = (i: number) => {
    const next = (i + total) % total;
    setIndex(next);
    strip.current?.querySelectorAll('button')[next]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  };

  return (
    <section aria-label={labels.gallery} aria-roledescription="carousel" className="grid gap-2">
      <div
        className="relative overflow-hidden rounded-2xl bg-slate-100 print:hidden"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') go(index - 1);
          else if (e.key === 'ArrowRight') go(index + 1);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[index]}
          alt={`${name} — ${fill(labels.photo, { n: index + 1, total })}`}
          className="aspect-[4/3] w-full object-cover sm:aspect-[16/9]"
          fetchPriority={index === 0 ? 'high' : undefined}
        />
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label={labels.prev}
              className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label={labels.next}
              className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
            <p className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white" aria-live="polite">
              {fill(labels.photo, { n: index + 1, total })}
            </p>
          </>
        )}
      </div>
      {total > 1 && (
        <ul ref={strip} className="flex gap-2 overflow-x-auto pb-1 print:hidden">
          {images.map((src, i) => (
            <li key={src + i} className="shrink-0">
              <button
                type="button"
                onClick={() => go(i)}
                aria-label={fill(labels.photo, { n: i + 1, total })}
                aria-current={i === index ? 'true' : undefined}
                className={`block overflow-hidden rounded-lg border-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500 ${
                  i === index ? 'border-emerald-600' : 'border-transparent opacity-80 hover:opacity-100'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" className="h-16 w-24 object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Print: first photos in a grid */}
      <div className="hidden grid-cols-2 gap-2 print:grid">
        {images.slice(0, 4).map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src + i} src={src} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
        ))}
      </div>
    </section>
  );
}
