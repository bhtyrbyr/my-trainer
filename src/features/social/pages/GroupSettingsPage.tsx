import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { GroupedList, ListRow } from '@/components/ui/GroupedList'
import * as api from '../api'
import { useGroup, useSocialAction } from '../hooks'
import { groupFormSchema, type GroupForm, type GroupInfo } from '../schema'
import { GroupFields } from '../components/GroupSheets'
import { BackLink, ListSkeleton } from '../components/parts'

/** /social/g/:id/settings (owner/admin; the RPCs refuse anyone else): rename, visibility, code, delete. */
export function GroupSettingsPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation('social')
  const group = useGroup(id)
  return (
    <PageShell
      title={t('groups.settings')}
      leading={<BackLink fallback={`/social/g/${id}`} title={t('groups.settings')} />}
    >
      <div className="mx-auto max-w-xl pb-6">
        {group.isLoading ? (
          <ListSkeleton tall />
        ) : group.data ? (
          <SettingsForm g={group.data} />
        ) : (
          <ErrorNote error={group.error ?? new Error('NOT_FOUND')} />
        )}
      </div>
    </PageShell>
  )
}

function SettingsForm({ g }: { g: GroupInfo }) {
  const { t } = useTranslation('social')
  const navigate = useNavigate()
  const [form, setForm] = useState<GroupForm>({
    name: g.name ?? '',
    description: g.description ?? '',
    visibility: g.visibility === 'closed' ? 'closed' : 'open',
  })
  const [confirm, setConfirm] = useState<null | 'rotate' | 'delete'>(null)
  const save = useSocialAction((f: GroupForm) =>
    api.updateGroup(g.group_id!, {
      name: f.name.trim(),
      description: f.description.trim(),
      visibility: f.visibility,
    }),
  )
  const rotate = useSocialAction(
    () => api.rotateGroupCode(g.group_id!),
    () => setConfirm(null),
  )
  const del = useSocialAction(
    () => api.deleteGroup(g.group_id!),
    () => navigate('/social/search?s=groups', { replace: true }),
  )
  const dirty =
    form.name !== (g.name ?? '') ||
    form.description !== (g.description ?? '') ||
    form.visibility !== g.visibility
  const valid = groupFormSchema.safeParse(form).success

  return (
    <div className="space-y-7">
      <section className="space-y-4">
        <GroupFields value={form} onChange={setForm} />
        <ErrorNote error={save.error} />
        <Button
          size="lg"
          className="w-full"
          disabled={!dirty || !valid || save.isPending}
          onClick={() => save.mutate(form)}
        >
          {save.isPending && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {save.isSuccess && !dirty ? t('saved') : t('save')}
        </Button>
      </section>

      <GroupedList title={t('groups.code')} footer={t('groups.rotateHint')}>
        <ListRow label={<span className="tabular tracking-[0.08em]">{g.invite_code}</span>} />
        <ListRow
          icon={RefreshCw}
          label={t('groups.rotate')}
          onClick={() => setConfirm('rotate')}
          chevron={false}
        />
      </GroupedList>

      {g.my_role === 'owner' && (
        <GroupedList>
          <ListRow
            icon={Trash2}
            label={t('groups.delete')}
            destructive
            onClick={() => setConfirm('delete')}
            chevron={false}
          />
        </GroupedList>
      )}

      <ConfirmSheet
        open={confirm === 'rotate'}
        title={t('groups.rotateTitle')}
        body={t('groups.rotateHint')}
        confirmLabel={t('groups.rotate')}
        pending={rotate.isPending}
        error={rotate.error}
        onConfirm={() => rotate.mutate(undefined)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm === 'delete'}
        title={t('groups.deleteTitle', { name: g.name })}
        body={t('groups.deleteBody')}
        confirmLabel={t('groups.delete')}
        tone="danger"
        pending={del.isPending}
        error={del.error}
        onConfirm={() => del.mutate(undefined)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
