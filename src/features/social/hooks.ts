import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import * as api from './api'
import { nextCursor } from './logic'
import type { PostItem } from './schema'

/**
 * Every key starts with 'social': the offline policy never writes these to IndexedDB (other users'
 * content), and one invalidation refreshes the whole social side after a write.
 */
export const socialKeys = {
  all: ['social'] as const,
  me: ['social', 'me'] as const,
  feed: (mode: 'following' | 'discover') => ['social', 'feed', mode] as const,
  userPosts: (id: string) => ['social', 'posts', 'user', id] as const,
  groupPosts: (id: string) => ['social', 'posts', 'group', id] as const,
  post: (id: string) => ['social', 'post', id] as const,
  profile: (id: string) => ['social', 'profile', id] as const,
  followers: (id: string) => ['social', 'followers', id] as const,
  following: (id: string) => ['social', 'following', id] as const,
  requests: ['social', 'requests'] as const,
  blocked: ['social', 'blocked'] as const,
  searchUsers: (q: string) => ['social', 'search-users', q] as const,
  notifications: ['social', 'notifications'] as const,
  unread: ['social', 'unread'] as const,
  myGroups: ['social', 'groups', 'mine'] as const,
  searchGroups: (q: string) => ['social', 'groups', 'search', q] as const,
  group: (id: string) => ['social', 'group', id] as const,
  groupMembers: (id: string) => ['social', 'group-members', id] as const,
  groupBans: (id: string) => ['social', 'group-bans', id] as const,
  adminReports: (status: 'open' | 'resolved') => ['social', 'admin-reports', status] as const,
}

export function useSocialMe() {
  return useQuery({ queryKey: socialKeys.me, queryFn: api.fetchMySocial, staleTime: 5 * 60_000 })
}

/** True once the caller has joined (and not paused) the social side. */
export function useSocialEnabled(): boolean {
  return useSocialMe().data?.enabled === true
}

function usePosts(key: QueryKey, fetch: (before: string | undefined) => Promise<PostItem[]>, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetch(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => nextCursor(last),
    enabled,
    staleTime: 30_000,
  })
}
export type PostsQuery = ReturnType<typeof usePosts>

export const useFeed = (mode: 'following' | 'discover') =>
  usePosts(socialKeys.feed(mode), mode === 'following' ? api.fetchFeed : api.fetchDiscover)
export const useUserPosts = (id: string, enabled: boolean) =>
  usePosts(socialKeys.userPosts(id), (b) => api.fetchUserPosts(id, b), enabled)
export const useGroupPosts = (id: string, enabled: boolean) =>
  usePosts(socialKeys.groupPosts(id), (b) => api.fetchGroupPosts(id, b), enabled)

export const usePost = (id: string) =>
  useQuery({ queryKey: socialKeys.post(id), queryFn: () => api.fetchPost(id) })
export const useSocialProfile = (id: string, enabled = true) =>
  useQuery({
    queryKey: socialKeys.profile(id),
    queryFn: () => api.fetchProfile(id),
    enabled: enabled && Boolean(id),
  })
export const useFollowers = (id: string, enabled = true) =>
  useQuery({ queryKey: socialKeys.followers(id), queryFn: () => api.fetchFollowers(id), enabled })
export const useFollowing = (id: string, enabled = true) =>
  useQuery({ queryKey: socialKeys.following(id), queryFn: () => api.fetchFollowing(id), enabled })
export const useFollowRequests = (enabled = true) =>
  useQuery({ queryKey: socialKeys.requests, queryFn: api.fetchFollowRequests, enabled })
export const useBlocked = (enabled = true) =>
  useQuery({ queryKey: socialKeys.blocked, queryFn: api.fetchBlocked, enabled })
export const useSearchUsers = (q: string) =>
  useQuery({
    queryKey: socialKeys.searchUsers(q),
    queryFn: () => api.searchUsers(q),
    enabled: q.length >= 2,
    staleTime: 30_000,
  })

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: socialKeys.notifications,
    queryFn: ({ pageParam }) => api.fetchNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => nextCursor(last, 30),
  })
}

/** Unread social notifications; 0 while the caller is not (or no longer) in Community. */
export function useUnreadCount(): number {
  const enabled = useSocialEnabled()
  const q = useQuery({
    queryKey: socialKeys.unread,
    queryFn: api.fetchUnreadCount,
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  return enabled ? (q.data ?? 0) : 0
}

export const useMyGroups = (enabled = true) =>
  useQuery({ queryKey: socialKeys.myGroups, queryFn: api.fetchMyGroups, enabled })
export const useSearchGroups = (q: string) =>
  useQuery({
    queryKey: socialKeys.searchGroups(q),
    queryFn: () => api.searchGroups(q),
    enabled: q.length >= 2,
    staleTime: 30_000,
  })
export const useGroup = (id: string) =>
  useQuery({ queryKey: socialKeys.group(id), queryFn: () => api.fetchGroup(id) })
export const useGroupMembers = (id: string, enabled: boolean) =>
  useQuery({ queryKey: socialKeys.groupMembers(id), queryFn: () => api.fetchGroupMembers(id), enabled })

export const useGroupBans = (id: string, enabled: boolean) =>
  useQuery({ queryKey: socialKeys.groupBans(id), queryFn: () => api.fetchGroupBans(id), enabled })

export const useAdminReports = (status: 'open' | 'resolved', enabled = true) =>
  useQuery({
    queryKey: socialKeys.adminReports(status),
    queryFn: () => api.adminListReports(status),
    enabled,
    staleTime: 30_000,
  })

/**
 * A write followed by a refresh of the whole social cache (cheap: only mounted queries refetch).
 * `keep` names a second-level key to leave alone (the notifications inbox keeps an answered row visible).
 */
export function useSocialAction<A, R = unknown>(
  fn: (args: A) => Promise<R>,
  onDone?: (r: R, args: A) => void,
  keep?: string,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, args) => {
      // ['share'] holds the composer's view of the same state (enabled, my groups)
      await Promise.all([
        qc.invalidateQueries({ queryKey: socialKeys.all, predicate: (q) => !keep || q.queryKey[1] !== keep }),
        qc.invalidateQueries({ queryKey: ['share'] }),
      ])
      onDone?.(r, args)
    },
  })
}
