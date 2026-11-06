'use client';

import { useState } from 'react';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import type { PostMedia } from '@/lib/social/model';

interface Texts {
  share: string;
  download: string;
  copy: string;
  copied: string;
  steps: string;
}

const extOf = (m: PostMedia, type: string) => (m.type === 'video' ? (type.includes('quicktime') ? 'mov' : 'mp4') : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg');

export function StatusShare({ media, caption, texts }: { media: PostMedia[]; caption: string; texts: Texts }) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [canShare] = useState(() => typeof navigator !== 'undefined' && typeof navigator.canShare === 'function');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the caption stays selectable on the page.
    }
  };

  const share = async () => {
    setSharing(true);
    try {
      const files = await Promise.all(
        media.map(async (m, i) => {
          const res = await fetch(m.url);
          const blob = await res.blob();
          return new File([blob], `status-${i + 1}.${extOf(m, blob.type)}`, { type: blob.type });
        }),
      );
      if (caption) await navigator.clipboard?.writeText(caption).catch(() => undefined);
      if (navigator.canShare?.({ files })) await navigator.share({ files, text: caption });
      else await navigator.share({ text: caption });
    } catch {
      // Cancelled by the user or not supported: downloads stay available.
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {media.map((m, i) => (
          <li key={i} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {m.type === 'video' ? (
              <video src={m.url} controls playsInline className="max-h-[70vh] w-full bg-black object-contain" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- post media
              <img src={m.url} alt="" className="max-h-[70vh] w-full object-contain" />
            )}
            <a href={m.url} download className="flex items-center justify-center gap-2 border-t border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download className="size-4" aria-hidden /> {texts.download}
            </a>
          </li>
        ))}
      </ul>

      {caption && (
        <div className="space-y-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <p className="whitespace-pre-line break-words text-sm">{caption}</p>
          <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
            {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? texts.copied : texts.copy}
          </button>
        </div>
      )}

      {canShare && (
        <button
          type="button"
          disabled={sharing}
          onClick={() => void share()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-[#1fb857] disabled:opacity-60"
        >
          <Share2 className="size-5" aria-hidden /> {texts.share}
        </button>
      )}
      <p className="text-xs text-slate-500">{texts.steps}</p>
    </div>
  );
}
