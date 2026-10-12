// The legal entity behind Whasalia, shown on public and legal pages
// (Meta business verification checks that these match the company's documents).
export const COMPANY = {
  brand: 'Whasalia',
  legalName: 'Grupo Fazzilito E.I.R.L.',
  taxIdLabel: 'RUC',
  taxId: '20616065484',
  street: 'Av. Daniel Alcides Carrión 1886',
  city: 'Huancayo',
  region: 'Junín',
  postalCode: '12004',
  country: { es: 'Perú', en: 'Peru' },
  email: 'grupofazzilito@gmail.com',
} as const

export function companyAddress(locale: 'es' | 'en') {
  const c = COMPANY
  return `${c.street}, ${c.city} ${c.postalCode}, ${c.region}, ${c.country[locale]}`
}
