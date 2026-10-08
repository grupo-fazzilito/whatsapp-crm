import { Building2 } from 'lucide-react';

// Language is unknown here (the listing could not be loaded), so the
// message is bilingual.
export default function ListingNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 text-center text-slate-900 [color-scheme:light]">
      <div className="grid max-w-sm justify-items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700" aria-hidden>
          <Building2 className="size-6" />
        </span>
        <h1 className="text-xl font-bold">Propiedad no disponible</h1>
        <p className="text-slate-700">Esta propiedad ya no está publicada o el enlace no es correcto.</p>
        <p lang="en" className="text-sm text-slate-600">
          This property is no longer listed or the link is not correct.
        </p>
      </div>
    </main>
  );
}
