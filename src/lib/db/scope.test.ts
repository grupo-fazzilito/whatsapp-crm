import { describe, expect, it } from 'vitest'
import { scopeArgs, TenantScopeError } from './scope'

const WS = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

describe('tenant scope', () => {
  it('adds the workspace to reads', () => {
    expect(scopeArgs('contacts', 'findMany', { where: { name: 'Ana' }, take: 5 }, WS)).toEqual({ where: { name: 'Ana', workspace_id: WS }, take: 5 })
    expect(scopeArgs('contacts', 'findUnique', { where: { id: 'c1' } }, WS)).toEqual({ where: { id: 'c1', workspace_id: WS } })
    expect(scopeArgs('messages', 'count', undefined, WS)).toEqual({ where: { workspace_id: WS } })
  })
  it('refuses to read another workspace explicitly', () => {
    expect(() => scopeArgs('contacts', 'findMany', { where: { workspace_id: OTHER } }, WS)).toThrow(TenantScopeError)
    expect(() => scopeArgs('contacts', 'findMany', { where: { workspace_id: { in: [WS, OTHER] } } }, WS)).toThrow(TenantScopeError)
  })
  it('forces created rows into the workspace', () => {
    expect(scopeArgs('tags', 'create', { data: { name: 'vip' } }, WS)).toEqual({ data: { name: 'vip', workspace_id: WS } })
    expect(scopeArgs('tags', 'createMany', { data: [{ name: 'a' }, { name: 'b', workspace_id: WS }] }, WS)).toEqual({
      data: [{ name: 'a', workspace_id: WS }, { name: 'b', workspace_id: WS }],
    })
    expect(() => scopeArgs('tags', 'create', { data: { name: 'x', workspace_id: OTHER } }, WS)).toThrow(TenantScopeError)
  })
  it('scopes updates/deletes and blocks moving rows', () => {
    expect(scopeArgs('deals', 'updateMany', { where: { stage_id: 's' }, data: { title: 't' } }, WS)).toEqual({ where: { stage_id: 's', workspace_id: WS }, data: { title: 't' } })
    expect(scopeArgs('deals', 'delete', { where: { id: 'd' } }, WS)).toEqual({ where: { id: 'd', workspace_id: WS } })
    expect(() => scopeArgs('deals', 'update', { where: { id: 'd' }, data: { workspace_id: OTHER } }, WS)).toThrow(TenantScopeError)
  })
  it('upsert scopes where, create and update', () => {
    expect(scopeArgs('billing_accounts', 'upsert', { where: { workspace_id: WS }, create: { email: 'a' }, update: { email: 'b' } }, WS)).toEqual({
      where: { workspace_id: WS },
      create: { email: 'a', workspace_id: WS },
      update: { email: 'b' },
    })
  })
  it('workspace row: only its own id, never create/delete', () => {
    expect(scopeArgs('workspaces', 'findUnique', { where: { id: WS } }, WS)).toEqual({ where: { id: WS } })
    expect(() => scopeArgs('workspaces', 'findMany', { where: { id: OTHER } }, WS)).toThrow(TenantScopeError)
    expect(() => scopeArgs('workspaces', 'delete', { where: { id: WS } }, WS)).toThrow(TenantScopeError)
  })
  it('tables without a workspace need the system client', () => {
    expect(() => scopeArgs('users', 'findMany', {}, WS)).toThrow(/system client/)
    expect(() => scopeArgs('platform_settings', 'findUnique', { where: { key: 'ai' } }, WS)).toThrow(TenantScopeError)
  })
})
