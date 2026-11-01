# Social platform spec (binding)

Product decisions (2026-11-01, user): follow + private accounts; mutual follow = friend; likes and social notifications (no comments, no DMs); blocking and reporting always; groups (open or closed, closed joined by invite link/code or approved request); shared progress photos become an unencrypted, downscaled copy after an explicit per-share warning; **under 18: social completely closed**; social is opt-in with its own consent and can be left at any time; the rest of the app works without it.

## 1. Principles
- Nothing on the social side reads private tables of another user. A post stores a **snapshot** (jsonb) of what was shared at that moment (workout summary, program, meal macros). RLS on workout/meal/photo tables stays owner-only.
- Visibility is decided in one place: `public.can_view_post(p_post uuid)` (security definer, stable) and `public.can_view_profile(p_user uuid)`; every social RLS policy and RPC uses them.
- A viewer must be social-enabled to see anything social. A user who leaves the social side disappears for everyone and their social data is deleted.
- No points for social actions (no farming). Social never shows weight, sleep or nutrition unless the user explicitly posts it.
- Free tier: images downscaled on device to max 1280 px long edge, JPEG ~q0.8 (~150-300 KB), at most 4 per post, 20 posts per user per day, 200 likes per day, 50 follow actions per day.

## 2. Database (migrations 2026111*)
- `social_profiles (user_id pk -> auth.users cascade, enabled bool not null default false, is_private bool not null default true, discoverable bool not null default true, bio text <= 160, enabled_at, updated_at)`. Enabling goes through `social_enable(p_consent_version text)`: requires approved/onboarded/not blocked, a stored birth year and age >= 18, records consent kind `social` (record_consent gains the kind; version from `app_config.social_consent_version`). `social_disable(p_delete boolean default true)`: deletes posts (and their storage objects via a cleanup queue), likes, follows both ways, group memberships (ownership transfers to the oldest admin/member or the group is deleted when empty), notifications, then sets enabled=false. A birth-year change to under 18 auto-disables (trigger on profile_private).
- `follows (follower_id, followee_id, status 'pending'|'accepted', created_at, accepted_at, pk(follower_id, followee_id), check follower <> followee)`. `social_follow(p_user)`: accepted when target is public, pending when private; refused when blocked either way or either side not enabled. `social_respond_follow(p_follower, p_accept)`, `social_unfollow(p_user)`, `social_remove_follower(p_user)`. Switching a private account to public accepts pending requests.
- `blocks (blocker_id, blocked_id, created_at, pk)`. `social_block(p_user)` also deletes follows both ways and the blocked user's likes on the blocker's posts; blocked users never see each other (profiles, posts, groups member lists show them as hidden).
- `posts (id uuid, author_id, kind 'text'|'workout'|'program'|'meal'|'photo'|'progress'|'compare', body text <= 1000, payload jsonb (validated per kind, <= 16 KB), audience 'public'|'followers'|'friends'|'group', group_id null unless audience='group', created_at, like_count int)`. Insert only via `social_create_post(...)` (rate limit, payload validation, group membership check). Author can delete (`social_delete_post`) and change audience.
- `post_media (id, post_id cascade, author_id, path, width, height, position)`; storage bucket `social-media` (private, 600 KB limit, image/jpeg + image/webp), path `<author_id>/<post_id>/<uuid>.jpg`; read policy `can_view_post((storage.foldername(name))[2]::uuid)`; write only own prefix; delete with the post.
- `post_likes (post_id, user_id, created_at, pk)`; `social_like/unlike`; like_count maintained by trigger.
- `groups (id, owner_id, name 3..60, description <= 300, visibility 'open'|'closed', invite_code text unique (random 10 chars, rotatable), created_at)`, `group_members (group_id, user_id, role 'owner'|'admin'|'member', status 'active'|'pending'|'invited', created_at, pk)`. RPCs: `group_create`, `group_update`, `group_join(p_group)` (open -> active; closed -> pending request), `group_join_by_code(p_code)` (-> active), `group_invite(p_group, p_user)` (-> invited; user accepts/declines), `group_respond(...)`, `group_set_role`, `group_remove_member`, `group_leave`, `group_rotate_code`, `group_delete`. Closed groups are visible in search by name only (no posts, no members) unless member; open groups show posts to social-enabled users. Max 20 groups owned per user, 200 members per group.
- `reports (id, reporter_id, target_kind 'post'|'user'|'group', target_id, reason text <= 300, status 'open'|'resolved', created_at)`; admin queue + `admin_remove_post`.
- `social_notifications (id, user_id, kind 'follow'|'follow_request'|'follow_accepted'|'like'|'group_invite'|'group_request'|'group_accepted', actor_id, post_id, group_id, created_at, read_at, pushed_at)`, written by triggers; likes are collapsed (one per post per hour). Kept 60 days (cron cleanup). Push: `dispatch_reminders` also sends unpushed social notifications when the user enabled `social_push` (user_settings), at most one push per user per 10 minutes.
- `can_view_post`: author = me; else both enabled, no block either way, and: public -> author not private OR I am an accepted follower; followers -> accepted follower; friends -> mutual accepted; group -> I am an active member.
- Reads: `social_feed(p_before timestamptz, p_limit int)` (own + followed + my groups' posts, keyset), `social_discover(...)` (public posts of public, discoverable accounts), `social_profile(p_user)` (display name, username, avatar, bio, level, badges, counts, relation state, can_view), `social_user_posts(p_user, p_before)`, `social_group_posts(p_group, p_before)`, `social_search_users(p_query)` (only enabled + discoverable, never e-mails), `social_followers/following(p_user)` (only when profile visible).
- pgTAP: visibility matrix (public/private x follower/friend/stranger/blocked/group), under-18 refusal, leaving deletes everything, rate limits, storage policy, allow-list.

## 3. Sharing sources (client)
- Workout: finished-session summary card -> "Share" (date, duration, volume, exercises with best set; no notes).
- Program: a workout template or a coach program -> "Share"; viewers can "Copy to my templates" (catalog exercises only; custom exercises become names).
- Meal: photo (optional, picked when sharing) + macros of the meal.
- Photo: personal photo from camera/gallery (EXIF stripped, downscaled).
- Progress photo: from the album viewer -> "Share" -> warning sheet (unencrypted copy, who sees it, how to remove) -> decrypt on device, downscale, upload.
- Compare: from the album compare screen -> "Share" -> composite rendered on a canvas (side by side with dates) -> same warning.

## 4. UI
- New bottom-tab structure is decided with the UI/UX audit; the social area needs: Feed (following / discover / groups), user profile page (header, follow button, posts grid), own social profile and settings (private account, discoverable, bio, followers/following management, requests, blocked users, leave social), groups (list, detail, members, invite link/code, settings), notifications inbox, composer (audience picker, sources above), report and block from every user/post menu.
- Admin: reports queue.

## 5. KVKK
- New consent kind `social` (versioned), separate from the notice. Notice gains a "Social" section: what is shown to whom, snapshots, unencrypted copies of shared photos, under-18 exclusion, blocking/reporting, leaving deletes social data, retention (notifications 60 days, reports until resolved + 30 days). `noticeVersion` bump. Export includes the user's posts, likes, follows, groups.

## 5b. Mentions (@tagging, migration 20261180000000)
- A post may tag people: `social_create_post(..., p_mentions uuid[])`; stored in `post_mentions (post_id, user_id)` (RLS on, no policies, no grants: reads only via RPCs). Every post RPC returns `mentions jsonb` = `[{user_id, username, display_name}]` (tagging order; people who left Community or are blocked with the viewer are left out).
- Rule (all must hold for the post's audience/group, `private.mention_ok`):
  a) the tagged user is social-active, not the author, no block either way, and has `social_profiles.allow_mentions` on (default true);
  b) group post: an active member of that group; otherwise an accepted follow in either direction;
  c) the tagged user could view the post under its audience (`private.post_audience_ok`, the same code `can_view_post` uses).
  Mentions never widen who sees a post (`can_view_post` ignores `post_mentions`).
- Limits: at most 10 per post (`TOO_MANY_MENTIONS`), 50 per author per day (`RATE_LIMITED`, counted in the activity log, survives deletes). A rule failure on publish raises `MENTION_NOT_ALLOWED`. Changing the audience/group of a post drops the mentions that no longer pass; a block drops the mentions between the two users.
- Composer: typing `@` opens a flat suggestion list from `social_mention_candidates(p_query, p_audience, p_group)` (max 8, only people allowed for the CURRENT audience/group, empty query = recent relations), debounced 200 ms. Picking writes `@username ` and adds a removable chip; chips whose `@username` was deleted from the text are dropped before publishing. When the audience changes every chip is re-checked; ones no longer allowed are struck through with a one-line reason and not sent.
- Rendering: one tokenizer (`src/features/social/mentions.ts`, unit-tested) splits a body into text, hashtags and mentions. `@username` (3-20 of `[A-Za-z0-9_]`, case-insensitive, not glued to a word, `.`, `@` or `&`) links to `/social/u/:user_id` in volt only when it is in the post's `mentions`; any other `@text` stays plain.
- Notification kind `mention` (with `post_id`), opens the post; removing the mention removes the notification.
- Untag: the tagged user can remove themselves from any post (`social_remove_mention(p_post)`; post menu "Remove my tag", confirm sheet). The author is not notified.
- Toggle: Settings > Community "Allow mentions" (`social_update_settings(p_allow_mentions)`). Off: nobody can tag the user from then on (existing tags stay until removed).
- Profile tab (`/me`): Posts | Tagged | Badges; Tagged (`?tab=tagged`) lists `social_mentioned_posts(p_before, p_limit)` (caller only, still only posts the caller may view) with the same list/grid as Posts. Query key `['social', 'posts', 'mentioned']` (non-persisted root).
- KVKK: the notice's Community section says people you interact with can tag you in posts visible to you, and that tagging can be turned off and tags removed.

## 6. Badges (also requested 2026-11-01)
Extend the badge set (same mechanism, no points): more tiers and new kinds, e.g. workouts 10/50/100/250, streak 100/365, sets 500/1000/5000, volume 10 t / 100 t / 1000 t, PR 10/50, cardio minutes 600/3000, habits 100/365, to-dos 200, water goal days 30, sleep log days 30, photos 25, weigh-ins 30, early bird (5 workouts started before 07:00), weekend warrior (10 weekend workouts), coach plan saved (1). Icons and TR/EN names and descriptions.
