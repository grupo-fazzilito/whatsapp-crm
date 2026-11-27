// What a backup can include (client-safe: the settings card imports it).
export const DATASETS = ['conversations', 'contacts', 'products', 'automations', 'templates'] as const
export type Dataset = (typeof DATASETS)[number]
