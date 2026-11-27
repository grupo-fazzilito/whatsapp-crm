// The full backup ZIP against a real PostgreSQL.
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/backup
import { afterAll, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { pgTest } from '@/lib/test-utils/pg'
import { DATASETS, type Dataset } from './datasets-list'

vi.mock('server-only', () => ({}))

const pg = await pgTest()

describe.skipIf(!pg)('full backup ZIP', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  const { backupZipStream } = await import('./datasets')
  const ws = await workspace({ name: 'Respaldo total' })
  const other = await workspace({ name: 'Otro negocio' })
  afterAll(async () => {
    await cleanup(ws, other)
    await prisma.$disconnect()
  })

  /** Everything a business can back up, each value marked with `mark`. */
  const seed = async (workspaceId: string, mark: string) => {
    const contact = await prisma.contacts.create({ data: { workspace_id: workspaceId, name: `Contacto ${mark}`, phone: '+51911111111', email: `${mark}@x.pe`, company: `Empresa ${mark}`, created_at: new Date('2026-11-01T15:00:00Z') } })
    const tag = await prisma.tags.create({ data: { workspace_id: workspaceId, name: `Etiqueta ${mark}` } })
    await prisma.contact_tags.create({ data: { workspace_id: workspaceId, contact_id: contact.id, tag_id: tag.id } })
    const field = await prisma.custom_fields.create({ data: { workspace_id: workspaceId, field_name: `Campo ${mark}` } })
    await prisma.contact_custom_values.create({ data: { workspace_id: workspaceId, contact_id: contact.id, custom_field_id: field.id, value: `Valor ${mark}` } })
    const conv = await prisma.conversations.create({ data: { workspace_id: workspaceId, contact_id: contact.id, channel_type: 'whatsapp', channel_name: 'Tienda' } })
    await prisma.messages.create({ data: { workspace_id: workspaceId, conversation_id: conv.id, sender_type: 'customer', content_text: `Mensaje ${mark}` } })
    const cat = await prisma.product_categories.create({ data: { workspace_id: workspaceId, name: `Categoría ${mark}` } })
    const product = await prisma.products.create({
      data: { workspace_id: workspaceId, category_id: cat.id, name: `Producto ${mark}`, price: 49.9, sku: `SKU-${mark}`, stock: 3, images: [`https://cdn.x/${mark}.jpg`], attributes: { [`attr_${mark}`]: 'x' } },
    })
    await prisma.product_variants.create({ data: { workspace_id: workspaceId, product_id: product.id, name: `Variante ${mark}`, options: { Talla: 'M' }, sku: `SKU-${mark}-M` } })
    const auto = await prisma.automations.create({ data: { workspace_id: workspaceId, name: `Automatización ${mark}`, trigger_type: 'new_contact', is_active: true } })
    await prisma.automation_steps.createMany({
      data: [
        { workspace_id: workspaceId, automation_id: auto.id, step_type: 'send_message', step_config: { text: `Paso ${mark}` }, position: 1 },
        { workspace_id: workspaceId, automation_id: auto.id, step_type: 'add_tag', step_config: { tag: 'x' }, position: 2 },
      ],
    })
    await prisma.message_templates.create({
      data: { workspace_id: workspaceId, name: `plantilla_${mark}`, language: 'es', body_text: `Cuerpo ${mark}`, buttons: [{ type: 'url', text: 'Ver', value: 'https://x.pe' }], status: 'Approved' },
    })
  }
  await seed(ws.workspaceId, 'propio')
  await seed(other.workspaceId, 'ajeno')

  const download = async (workspaceId: string, datasets: Dataset[] = [...DATASETS], lang: 'es' | 'en' = 'es') => {
    const stream = backupZipStream({
      workspaceId,
      datasets,
      from: null,
      to: null,
      fromDay: null,
      toDay: null,
      includeInternal: false,
      timeZone: 'America/Lima',
      lang,
      origin: 'https://x',
    })
    const files = unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()))
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]))
  }

  it("has every file with only this business's rows", async () => {
    const files = await download(ws.workspaceId)
    expect(Object.keys(files)).toEqual([
      'LEEME.txt',
      'conversaciones.csv',
      'contactos.csv',
      'productos.csv',
      'productos-variantes.csv',
      'automatizaciones.json',
      'automatizaciones.csv',
      'plantillas.csv',
    ])
    const all = Object.values(files).join('\n')
    expect(all).toContain('propio')
    expect(all).not.toContain('ajeno')

    expect(files['conversaciones.csv']).toContain('Mensaje propio')
    const contacts = files['contactos.csv'].replace(/^﻿/, '').split('\r\n')
    expect(contacts[0]).toBe('Nombre,Teléfono,Correo,Empresa,Etiquetas,Canales,Campo propio,Creado,ID')
    expect(contacts[1]).toMatch(/^Contacto propio,'\+51911111111,propio@x\.pe,Empresa propio,Etiqueta propio,whatsapp,Valor propio,2026-11-01 10:00:00,/)
    const products = files['productos.csv'].replace(/^﻿/, '').split('\r\n')
    expect(products[0]).toBe('nombre,descripcion,precio,moneda,precio anterior,sku,stock,categoria,imagenes,etiquetas,destacado,activo,attr_propio,variantes,creado')
    expect(products[1]).toMatch(/^Producto propio,,49\.9,,,SKU-propio,3,Categoría propio,https:\/\/cdn\.x\/propio\.jpg,,No,Sí,x,1,/)
    expect(files['productos-variantes.csv']).toContain('Producto propio,SKU-propio,Variante propio,Talla: M,SKU-propio-M')
    const json = JSON.parse(files['automatizaciones.json'])
    expect(json.automations).toHaveLength(1)
    expect(json.automations[0].steps.map((s: { step_type: string }) => s.step_type)).toEqual(['send_message', 'add_tag'])
    expect(files['automatizaciones.csv']).toContain('Automatización propio,,new_contact,Sí,2,0,')
    expect(files['plantillas.csv']).toContain('plantilla_propio,Marketing,es,Approved')
    expect(files['plantillas.csv']).toContain('url: Ver: https://x.pe')
  })

  it("the other business's ZIP has only its own rows", async () => {
    const all = Object.values(await download(other.workspaceId)).join('\n')
    expect(all).toContain('ajeno')
    expect(all).not.toContain('propio')
  })

  it('only the chosen datasets, in English', async () => {
    const files = await download(ws.workspaceId, ['contacts', 'templates'], 'en')
    expect(Object.keys(files)).toEqual(['README.txt', 'contacts.csv', 'templates.csv'])
    expect(files['README.txt']).not.toContain('conversations.csv')
  })
})
