import type { PropertyCapture } from '@/lib/real-estate/captures-core';

export interface CaptureListItem extends PropertyCapture {
  contact: { id: string; name: string | null; phone: string | null } | null;
  /** Displayable first photo (signed when private). */
  cover: string | null;
}

export interface CaptureDetail extends PropertyCapture {
  photo_urls: string[];
  contact: { id: string; name: string | null; phone: string | null } | null;
  product: { id: string; name: string; is_active: boolean; public_url: string | null } | null;
}

/** Tailwind classes per status (column accent + chip), AA on light and dark. */
export const STATUS_TONE: Record<PropertyCapture['status'], string> = {
  new: 'bg-blue-600 text-white',
  contacted: 'bg-cyan-700 text-white',
  evaluated: 'bg-violet-600 text-white',
  signed: 'bg-amber-500 text-black',
  rejected: 'bg-slate-600 text-white',
  published: 'bg-emerald-600 text-white',
};
