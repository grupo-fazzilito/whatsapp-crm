import 'server-only'
import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/db/prisma'
import { COUNTRY_HEADER, REGION_COOKIE, isRegion, regionForCountry, type Region } from './regions'

/** The visitor's region: the picker/proxy cookie, else their country (first visit), else US. */
export async function requestRegion(): Promise<Region> {
  const saved = (await cookies()).get(REGION_COOKIE)?.value
  if (isRegion(saved)) return saved
  return regionForCountry((await headers()).get(COUNTRY_HEADER))
}

/**
 * The account's sales region. Accounts made before regions existed are Peruvian
 * (set by the migration); a new account takes the visitor's region the first
 * time billing is opened, and keeps it — only the platform admin changes it.
 */
export async function workspaceRegion(workspaceId: string): Promise<Region> {
  const row = await prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { billing_region: true } })
  if (isRegion(row?.billing_region)) return row.billing_region
  const region = await requestRegion().catch(() => 'us' as Region)
  await prisma.workspaces.updateMany({ where: { id: workspaceId, billing_region: null }, data: { billing_region: region } })
  return region
}
