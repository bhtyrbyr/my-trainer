import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Compass, Search, Trophy, Users } from 'lucide-react'
import { PageShell } from '@/components/layout/PageShell'
import { ErrorNote } from '@/components/ui/ErrorNote'
import { useFeed, useSocialMe } from '../hooks'
import { GroupRail } from '../components/GroupRail'
import { JoinIntro } from '../components/JoinIntro'
import {
  BellButton,
  EmptyState,
  HeaderIconLink,
  ListSkeleton,
  PostList,
  RowButton,
  ShareFab,
} from '../components/parts'
import { SectionTabs } from '@/components/ui/SectionTabs'
import { ComposerSheet } from '../components/shareBridge'

type Tab = 'home' | 'discover'
const TABS: readonly Tab[] = ['home', 'discover']

/**
 * Community tab (/social). Point of view: the posts are the page. Chrome is one title, three header
 * icons (search, ranking, bell), two words (Home | Discover) and one floating volt action. Home opens
 * with the "My groups" rail. `/social?tab=discover` is Discover; old links (?tab=groups, ?tab=ranking,
 * ?feed=discover) land on their new homes.
 */
export function SocialPage() {
  const { t } = useTranslation(['social', 'common'])
  const [params, setParams] = useSearchParams()
  const me = useSocialMe()
  const enabled = me.data?.enabled === true
  const [composer, setComposer] = useState(false)

  const raw = params.get('tab')
  if (raw === 'ranking') return <Navigate to="/social/ranking" replace />
  if (raw === 'groups') return <Navigate to="/social/search?s=groups" replace />
  const tab: Tab = raw === 'discover' || params.get('feed') === 'discover' ? 'discover' : 'home'
  const setTab = (v: Tab) => setParams(v === 'home' ? {} : { tab: v }, { replace: true })

  return (
    <PageShell
      title={t('social:title')}
      actions={
        <div className="-mr-2 flex items-center">
          {enabled && <HeaderIconLink to="/social/search" label={t('social:search.title')} icon={Search} />}
          <HeaderIconLink to="/social/ranking" label={t('social:ranking.title')} icon={Trophy} />
          {enabled && <BellButton className="mr-0" />}
        </div>
      }
    >
      <div className="mx-auto max-w-xl">
        {me.isLoading ? (
          <ListSkeleton tall />
        ) : me.error ? (
          <ErrorNote error={me.error} />
        ) : !enabled ? (
          <JoinIntro paused={me.data?.enabled === false && me.data.enabled_at != null} />
        ) : (
          <>
            <SectionTabs
              label={t('social:sections')}
              options={TABS}
              value={tab}
              onChange={setTab}
              labelOf={(v) => t(`social:tabs.${v}`)}
            />
            {tab === 'home' ? (
              <>
                <GroupRail />
                <HomeFeed onDiscover={() => setTab('discover')} />
              </>
            ) : (
              <DiscoverFeed />
            )}
            <ShareFab onClick={() => setComposer(true)} />
            <ComposerSheet open={composer} onClose={() => setComposer(false)} />
          </>
        )}
      </div>
    </PageShell>
  )
}

function HomeFeed({ onDiscover }: { onDiscover: () => void }) {
  const { t } = useTranslation('social')
  const feed = useFeed('following')
  return (
    <div className="pb-20">
      <PostList
        query={feed}
        empty={
          <EmptyState
            icon={Users}
            title={t('feed.emptyTitle')}
            body={t('feed.emptyBody')}
            action={
              <RowButton tone="secondary" onClick={onDiscover}>
                {t('feed.goDiscover')}
              </RowButton>
            }
          />
        }
      />
    </div>
  )
}

function DiscoverFeed() {
  const { t } = useTranslation('social')
  const feed = useFeed('discover')
  return (
    <div className="pb-20">
      <PostList
        query={feed}
        empty={
          <EmptyState icon={Compass} title={t('feed.discoverEmptyTitle')} body={t('feed.discoverEmptyBody')} />
        }
      />
    </div>
  )
}
