import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/db/tenant', () => ({ tenantDb: vi.fn() }))
vi.mock('@/lib/messaging/send', () => ({ sendMessage: vi.fn() }))
vi.mock('./engine', () => ({ runAgent: vi.fn(), handOverToHuman: vi.fn() }))

import { matchMenuOption, welcomeMenuOf } from './routing'
import type { WelcomeMenu } from './types'
import type { LoadedChannel } from '@/lib/channels'

const menu: WelcomeMenu = {
  enabled: true,
  question: '¿Qué estás buscando?',
  options: [
    { id: 'productos', label: 'Productos', target: { type: 'agent', agent_id: 'a1' } },
    { id: 'soporte', label: 'Soporte técnico', target: { type: 'agent', agent_id: 'a2' } },
    { id: 'humano', label: 'Hablar con alguien', target: { type: 'human' } },
  ],
}

describe('matchMenuOption', () => {
  it('matches a tapped option by its menu: id', () => {
    expect(matchMenuOption(menu, 'whatever', 'menu:soporte')?.id).toBe('soporte')
  })

  it('returns null for an unknown tapped id, even if the text would match', () => {
    expect(matchMenuOption(menu, 'Productos', 'menu:nope')).toBeNull()
  })

  it('ignores interactive ids that are not menu replies and falls back to the text', () => {
    expect(matchMenuOption(menu, 'productos', 'flow_btn_1')?.id).toBe('productos')
  })

  it('matches the label case-insensitively, ignoring punctuation and spaces', () => {
    expect(matchMenuOption(menu, '  SOPORTE TÉCNICO!  ', null)?.id).toBe('soporte')
    expect(matchMenuOption(menu, '¿Productos?', undefined)?.id).toBe('productos')
  })

  it('matches the option number (1-based)', () => {
    expect(matchMenuOption(menu, '1', null)?.id).toBe('productos')
    expect(matchMenuOption(menu, '3.', null)?.id).toBe('humano')
  })

  it('rejects out-of-range numbers, partial labels and empty text', () => {
    expect(matchMenuOption(menu, '0', null)).toBeNull()
    expect(matchMenuOption(menu, '4', null)).toBeNull()
    expect(matchMenuOption(menu, '1.5', null)).toBeNull()
    expect(matchMenuOption(menu, 'soporte', null)).toBeNull()
    expect(matchMenuOption(menu, '   ', null)).toBeNull()
  })
})

describe('welcomeMenuOf', () => {
  const channel = (welcome_menu: unknown) => ({ settings: { welcome_menu } }) as unknown as LoadedChannel

  it('returns the menu only when enabled with a question and options', () => {
    expect(welcomeMenuOf(channel(menu))).toBe(menu)
    expect(welcomeMenuOf(channel({ ...menu, enabled: false }))).toBeNull()
    expect(welcomeMenuOf(channel({ ...menu, question: '  ' }))).toBeNull()
    expect(welcomeMenuOf(channel({ ...menu, options: [] }))).toBeNull()
    expect(welcomeMenuOf(channel(undefined))).toBeNull()
  })
})
