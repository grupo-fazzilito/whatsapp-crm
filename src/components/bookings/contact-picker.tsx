'use client'

import { useEffect, useState } from 'react'
import { Loader2, Search, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/i18n/client'
import { useWorkspace } from '@/hooks/use-workspace'
import { api } from '@/components/business/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ContactLite } from './types'

/** Search-as-you-type contact selector with inline "new contact". */
export function ContactPicker({
  value,
  onChange,
  id,
}: {
  value: ContactLite | null
  onChange: (c: ContactLite | null) => void
  id?: string
}) {
  const t = useT()
  const { label } = useWorkspace()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContactLite[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (value) return
    let cancelled = false
    const handle = setTimeout(async () => {
      setLoading(true)
      const term = query.trim()
      const data = await api<{ contacts: ContactLite[] }>(`/api/bookings/contacts${term ? `?q=${encodeURIComponent(term)}` : ''}`)
        .then((d) => d.contacts)
        .catch(() => [] as ContactLite[])
      if (!cancelled) {
        setResults(data)
        setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, value])

  const create = async () => {
    if (!newName.trim() && !newPhone.trim()) return
    setSaving(true)
    let contact: ContactLite
    try {
      ;({ contact } = await api<{ contact: ContactLite }>('/api/bookings/contacts', {
        method: 'POST',
        body: { name: newName.trim() || newPhone.trim(), phone: newPhone.trim() || null },
      }))
    } catch (err) {
      setSaving(false)
      toast.error(err instanceof Error ? err.message : String(err))
      return
    }
    setSaving(false)
    onChange(contact)
    setCreating(false)
    setNewName('')
    setNewPhone('')
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-input px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{value.name || value.phone}</div>
          {value.phone && <div className="text-xs text-muted-foreground">{value.phone}</div>}
        </div>
        <Button type="button" size="icon-xs" variant="ghost" onClick={() => onChange(null)} aria-label={t('bookings.form.changeCustomer')}>
          <X className="size-3.5" />
        </Button>
      </div>
    )
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-lg border border-input p-3">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('bookings.form.newContactName')} autoFocus />
        <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder={t('bookings.form.newContactPhone')} inputMode="tel" />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
            {t('bookings.form.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={create} disabled={saving || (!newName.trim() && !newPhone.trim())}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('bookings.form.addContact')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
        <Input
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('bookings.form.searchCustomer', { customer: label('customer').toLocaleLowerCase() })}
          className="pl-8"
          autoComplete="off"
        />
      </div>
      <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
        {loading && results.length === 0 ? (
          <div className="flex justify-center py-3">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : results.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('bookings.form.noContacts')}</p>
        ) : (
          results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="truncate text-foreground">{c.name || c.phone}</span>
              {c.phone && <span className="shrink-0 text-xs text-muted-foreground">{c.phone}</span>}
            </button>
          ))
        )}
      </div>
      <Button type="button" size="xs" variant="ghost" onClick={() => setCreating(true)}>
        <UserPlus className="size-3.5" />
        {t('bookings.form.newContact')}
      </Button>
    </div>
  )
}
