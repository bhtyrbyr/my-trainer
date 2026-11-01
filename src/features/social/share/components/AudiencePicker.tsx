import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Segmented } from '@/components/ui/GroupedList'
import { cn } from '@/lib/utils'
import { useMyGroups } from '../hooks'
import { AUDIENCES, type AudienceChoice } from '../types'

/** Four-way segmented audience choice; "Group" opens the list of the user's active groups. */
export function AudiencePicker({ value, onChange }: { value: AudienceChoice; onChange: (v: AudienceChoice) => void }) {
  const { t } = useTranslation('share')
  const groups = useMyGroups(true)
  const list = groups.data ?? []
  return (
    <div className="space-y-2">
      <p className="section-title px-1">{t('audience.label')}</p>
      <Segmented
        label={t('audience.label')}
        value={value.audience}
        onChange={(audience) => onChange({ audience, groupId: audience === 'group' ? (value.groupId ?? list[0]?.id ?? null) : null })}
        options={AUDIENCES.map((a) => ({ value: a, label: t(`audience.${a}`) }))}
      />
      <p className="px-1 text-[12px] leading-snug text-ink-faint">{t(`audience.${value.audience}Hint`)}</p>
      {value.audience === 'group' && (
        <div role="radiogroup" aria-label={t('audience.pickGroup')} className="hairline divide-y divide-line overflow-hidden rounded-[var(--radius-card)] bg-bg">
          {groups.isLoading ? (
            <div className="h-11 animate-pulse bg-raised/50 motion-reduce:animate-none" />
          ) : list.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-muted">{t('audience.noGroups')}</p>
          ) : (
            list.map((g) => {
              const on = value.groupId === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ audience: 'group', groupId: g.id })}
                  className={cn('flex min-h-11 w-full items-center gap-3 px-4 text-left text-[15px]', on ? 'text-ink' : 'text-ink-muted')}
                >
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  {on && <Check className="size-4 text-volt" aria-hidden />}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

