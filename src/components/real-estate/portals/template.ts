'use client';

// "Plantilla portales inmobiliarios": an .xlsx with the columns agencies
// usually have in their Urbania / Adondevivir / Mercado Libre listings, in
// the names our auto-mapping recognises. The agency fills it with its own
// listings (or pastes the export of its CRM) and imports it here.

const HEADERS = [
  'codigo_aviso',
  'titulo',
  'descripcion',
  'operacion',
  'tipo_inmueble',
  'precio',
  'moneda',
  'dormitorios',
  'banos',
  'area_construida_m2',
  'estacionamientos',
  'distrito',
  'direccion',
  'latitud',
  'longitud',
  'mantenimiento',
  'piso',
  'ano_construccion',
  'amenidades',
  'estado',
  'fotos',
  'video',
  'url_aviso',
] as const;

const EXAMPLE: Record<(typeof HEADERS)[number], string | number> = {
  codigo_aviso: 'DEP-001',
  titulo: 'Departamento de 3 dormitorios con vista al parque',
  descripcion: 'Piso alto, cocina abierta, áreas comunes con piscina y gimnasio.',
  operacion: 'Venta',
  tipo_inmueble: 'Departamento',
  precio: 650000,
  moneda: 'PEN',
  dormitorios: 3,
  banos: 2,
  area_construida_m2: 110,
  estacionamientos: 1,
  distrito: 'Miraflores',
  direccion: 'Av. Ejemplo 123, Miraflores, Lima',
  latitud: -12.1211,
  longitud: -77.0297,
  mantenimiento: 450,
  piso: 8,
  ano_construccion: 2019,
  amenidades: 'Piscina, Gimnasio, Ascensor',
  estado: 'Disponible',
  fotos: 'https://example.com/foto-1.jpg | https://example.com/foto-2.jpg',
  video: 'https://www.youtube.com/watch?v=XXXXXXXXXXX',
  url_aviso: 'https://example.com/mi-aviso',
};

export async function downloadPortalTemplate(fileName: string) {
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet([[...HEADERS], HEADERS.map((h) => EXAMPLE[h])]);
  sheet['!cols'] = HEADERS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Propiedades');
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}
