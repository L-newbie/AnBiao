<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Avatar from '../components/Avatar.vue'
import DeleteButton from '../components/DeleteButton.vue'
import VisibilityToggle from '../components/VisibilityToggle.vue'
import StarIcon from '../components/StarIcon.vue'
import { config } from '../lib/config.js'
import { getDeviceId, getPoeticName, getShortCode, uploadsToday, remainingToday } from '../lib/device.js'
import { favoriteEntries } from '../lib/favorites.js'
import { visibilityOf, visibilityOverrides, isSyncing, PUBLIC } from '../lib/entryVisibility.js'
import { imageSrc, listSrc } from '../lib/images.js'
import { listOps, retryOp, discardOp, outboxCount } from '../lib/outbox.js'
import { drainOutbox } from '../lib/sync.js'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  myComments: { type: Array, default: () => [] },
})
const emit = defineEmits(['open', 'deleted', 'comment-deleted'])

// Last delete / visibility failure, shown under the list. Cleared on the next
// attempt. Shared by both sections — only one is on screen at a time.
const delErr = ref('')
function onDeleted(id) {
  delErr.value = ''
  emit('deleted', id)
}
function onDeleteError(msg) {
  delErr.value = msg
}
// The toggle already wrote to the data branch and set the local override, so
// there's nothing to propagate — just clear any stale error.
function onVisibilityToggled() {
  delErr.value = ''
}
function onCommentDeleted(id) {
  delErr.value = ''
  emit('comment-deleted', id)
}

const id = getDeviceId()
const poeticName = getPoeticName(id)
const shortCode = getShortCode(id)

// The Mine tab receives the unfiltered author-side list, so this is where my
// own private entries show up (they're excluded from the public feed upstream).
const mine = computed(() => props.entries.filter((e) => e.deviceId === id))
// favoriteEntries reads the shared reactive `favorites` ref, so un-starring an
// entry from this list drops it here immediately.
//
// Someone else's entry that has since gone private is dropped: it was starred
// while public, and it would otherwise sit here forever in a stranger's list.
// My own private entries stay — being private is the point, not a reason to
// hide them from me.
const favs = computed(() => {
  void visibilityOverrides.value
  return favoriteEntries(props.entries).filter(
    (e) => e.deviceId === id || visibilityOf(e) === PUBLIC,
  )
})
const remaining = remainingToday(config.maxUploadsPerDay)
const used = uploadsToday()

// Which of the three sections is showing. Not persisted — the tab always opens
// on 记录, the most-used section.
const section = ref('entries')
const sections = computed(() => [
  { key: 'entries', label: '记录', count: mine.value.length },
  { key: 'comments', label: '留言', count: props.myComments.length },
  { key: 'favorites', label: '收藏', count: favs.value.length },
])

const emptyText = {
  entries: '还没有留下什么。去投一条吧。',
  comments: '还没有说过话。',
  favorites: '还没有收藏。点开任意一条，按右上角的星形按钮。',
}

// Rows show the build-time thumbnail (they render at 48px — the full-size
// original is ~1600px). Falls back to the original per-entry if the thumbnail
// 404s, which happens when sharp failed on that one image at build time.
// Keyed by id because both lists below render many rows from a v-for.
const fellBack = ref(new Set())
function rowSrc(e) {
  return fellBack.value.has(e.id) ? imageSrc(e) : listSrc(e)
}
function onImgError(e) {
  if (fellBack.value.has(e.id)) return
  // Replace the Set rather than mutating: a plain .add() wouldn't retrigger
  // the template (ref only tracks reassignment of the value itself).
  fellBack.value = new Set(fellBack.value).add(e.id)
}

// Compact comment timestamp, matching DetailView's commentTime format.
function commentTime(c) {
  if (!c.createdAt) return ''
  try {
    const d = new Date(c.createdAt)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${mm}-${dd} ${hh}:${mi}`
  } catch {
    return c.createdAt
  }
}

// Where each of my comments landed. Raw lookup — this can return someone
// else's entry that has since gone private, so don't render from it directly;
// go through openableEntryOf below.
function entryOf(comment) {
  return props.entries.find((e) => e.id === comment.entryId)
}

// The entry a comment can actually be opened to.
//
// Someone else's entry that has since gone private is excluded, for the same
// reason favs excludes it: the comment was left while the entry was public,
// and DetailView renders the whole thing — image, description, location, every
// comment — to whoever opens it. My own private entries stay openable; being
// private is the point, not a reason to hide them from me.
function openableEntryOf(comment) {
  // Touch the override store so a toggle elsewhere re-renders these rows —
  // visibilityOf reads it, but that's invisible to Vue's tracking from here.
  void visibilityOverrides.value
  const entry = entryOf(comment)
  if (!entry) return null
  return entry.deviceId === id || visibilityOf(entry) === PUBLIC ? entry : null
}

// Subtitle for a comment row. Three distinct states, and collapsing the last
// two would misinform: a record that went private is not "syncing", nothing is
// in flight and waiting won't bring it back.
function commentPlace(comment) {
  const open = openableEntryOf(comment)
  if (open) return open.city || open.address || '该记录'
  return entryOf(comment) ? '记录已转私密' : '记录同步中'
}

function openComment(comment) {
  const entry = openableEntryOf(comment)
  // Only openable if the entry is live in the feed AND still visible to us. A
  // pending comment on an entry we can't see has nowhere to go.
  if (entry) emit('open', entry)
}

// ---- 同步队列 (offline outbox) ----
// Live view of IndexedDB outbox ops, refreshed on every gc-outbox-changed.
// SyncChip focuses this section (scroll) via the exposed anchor id.
const ops = ref([])
const queueEl = ref(null)
async function reloadOps() {
  ops.value = await listOps()
}
onMounted(() => {
  reloadOps()
  window.addEventListener('gc-outbox-changed', reloadOps)
})
onBeforeUnmount(() => window.removeEventListener('gc-outbox-changed', reloadOps))

const KIND_LABEL = {
  entry: '发布记录',
  comment: '留言',
  deleteEntry: '删除记录',
  deleteComment: '删除留言',
  visibility: '修改可见性',
}
function opLabel(op) {
  return KIND_LABEL[op.kind] || op.kind
}
function opSummary(op) {
  const p = op.payload || {}
  if (op.kind === 'entry') return (p.description || '').slice(0, 24) || p.id
  if (op.kind === 'comment') return (p.comment?.text || '').slice(0, 24) || p.entryId
  return p.entryId || ''
}
function opTime(op) {
  return commentTime({ createdAt: op.createdAt })
}
async function onRetryOp(op) {
  await retryOp(op.key)
  await drainOutbox()
}
async function onDiscardOp(op) {
  await discardOp(op.key)
  // Also drop the optimistic residue so a discarded entry doesn't linger in
  // the feed. App listens for this and reconciles pending/state.
  window.dispatchEvent(new CustomEvent('gc-outbox-discarded', { detail: { kind: op.kind, payload: op.payload } }))
}
// SyncChip scrolls here when tapped.
defineExpose({ queueEl })
</script>

<template>
  <div class="space-y-5 pt-6">
    <!-- identity card -->
    <section class="glass rounded-3xl p-6 flex flex-col items-center text-center gap-3">
      <Avatar :device-id="id" :size="84" />
      <h2 class="font-serif text-2xl text-mist-text">{{ poeticName }}</h2>
      <p class="font-mono text-xs text-mist-muted/70">#{{ shortCode }}</p>
    </section>

    <!-- stats -->
    <section class="grid grid-cols-3 gap-3">
      <div class="glass rounded-2xl p-4 text-center">
        <p class="font-serif text-2xl text-mist-text">{{ mine.length }}</p>
        <p class="text-xs text-mist-muted mt-1">我的记录</p>
      </div>
      <div class="glass rounded-2xl p-4 text-center">
        <p class="font-serif text-2xl text-mist-text">{{ used }}</p>
        <p class="text-xs text-mist-muted mt-1">今日已传</p>
      </div>
      <div class="glass rounded-2xl p-4 text-center">
        <p class="font-serif text-2xl text-rose-glow">{{ remaining }}</p>
        <p class="text-xs text-mist-muted mt-1">今日剩余</p>
      </div>
    </section>

    <!-- 同步队列 — only visible while the outbox has queued/failed ops -->
    <section v-if="outboxCount > 0" ref="queueEl" class="glass rounded-2xl p-3 space-y-2">
      <header class="flex items-center justify-between">
        <h3 class="font-serif text-sm text-mist-text">同步队列</h3>
        <span class="text-[11px] text-mist-muted/70">断网时的操作会在这里排队，联网后自动同步</span>
      </header>
      <div v-for="op in ops" :key="op.key" class="glass rounded-xl px-3 py-2 flex items-center gap-2">
        <span
          class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          :class="op.status === 'failed' ? 'bg-rose-400' : op.status === 'syncing' ? 'bg-amber-400 animate-pulse' : 'bg-accent'"
        ></span>
        <div class="min-w-0 flex-1">
          <p class="text-xs text-mist-text truncate">{{ opLabel(op) }}<span v-if="opSummary(op)" class="text-mist-muted/70"> · {{ opSummary(op) }}</span></p>
          <p class="text-[10px] text-mist-muted/60">
            {{ opTime(op) }}
            <span v-if="op.status === 'failed'" class="text-rose-glow"> · {{ op.lastErr || '同步失败' }}</span>
            <span v-else-if="op.status === 'syncing'" class="text-amber-300/80"> · 同步中…</span>
          </p>
        </div>
        <template v-if="op.status === 'failed'">
          <button class="text-[11px] text-accent shrink-0" @click="onRetryOp(op)">重试</button>
          <button class="text-[11px] text-mist-muted/70 shrink-0" @click="onDiscardOp(op)">放弃</button>
        </template>
      </div>
    </section>

    <!-- section switcher: 记录 / 留言 / 收藏 -->
    <section class="glass rounded-2xl p-1 grid grid-cols-3 gap-1">
      <button

        v-for="s in sections"
        :key="s.key"
        @click="section = s.key"
        class="rounded-xl py-2 text-sm transition"
        :class="section === s.key
          ? 'bg-gradient-to-r from-rose-soft to-rose-glow text-white font-semibold shadow'
          : 'text-mist-muted hover:text-mist-text hover:brightness-110'"
      >
        {{ s.label }}
        <span class="text-[11px] opacity-70">{{ s.count }}</span>
      </button>
    </section>

    <!-- panel -->
    <section class="space-y-2">
      <!-- 记录 — the row is a plain div, not a button: it holds the open
           action AND a delete button, and buttons can't nest. -->
      <template v-if="section === 'entries'">
        <div
          v-for="e in mine"
          :key="e.id"
          class="glass w-full rounded-2xl p-3 flex items-center gap-3"
        >
          <button
            @click="emit('open', e)"
            class="flex items-center gap-3 text-left min-w-0 flex-1 hover:brightness-110"
          >
            <img
              :src="rowSrc(e)"
              loading="lazy"
              decoding="async"
              @error="onImgError(e)"
              class="h-12 w-12 rounded-xl object-cover bg-mist-800/40 shrink-0"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm text-mist-text line-clamp-1">{{ e.city || e.address || '（无地址）' }}</p>
              <p class="text-xs text-mist-muted line-clamp-1">{{ e.description }}</p>
            </div>
          </button>
          <span
            v-if="isSyncing(e)"
            class="rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5 shrink-0"
          >同步中</span>
          <VisibilityToggle :entry="e" @toggled="onVisibilityToggled" @error="onDeleteError" />
          <DeleteButton :entry-id="e.id" @deleted="onDeleted" @error="onDeleteError" />
        </div>
        <p v-if="delErr" class="text-[11px] text-rose-glow px-1">{{ delErr }}</p>
      </template>

      <!-- 留言 (live + still-pending ones, flagged 同步中) — a plain div for
           the same reason as 记录 above: the row holds both an open action and
           a delete button, and buttons can't nest. -->
      <template v-else-if="section === 'comments'">
        <div
          v-for="c in myComments"
          :key="c.id"
          class="glass w-full rounded-2xl p-3 flex items-start gap-3"
        >
          <button
            @click="openComment(c)"
            :disabled="!openableEntryOf(c)"
            class="text-left min-w-0 flex-1 hover:brightness-110 disabled:opacity-60 disabled:cursor-default"
          >
            <p class="text-sm text-mist-muted leading-relaxed line-clamp-2 break-all">{{ c.text }}</p>
            <p class="text-xs text-mist-muted/70 mt-1 line-clamp-1">
              {{ commentTime(c) }} · {{ commentPlace(c) }}
            </p>
          </button>
          <span
            v-if="c._local"
            class="rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5 shrink-0"
          >同步中</span>
          <DeleteButton
            :entry-id="c.entryId"
            :comment-id="c.id"
            variant="comment"
            @deleted="onCommentDeleted"
            @error="onDeleteError"
          />
        </div>
        <p v-if="delErr" class="text-[11px] text-rose-glow px-1">{{ delErr }}</p>
      </template>

      <!-- 收藏 -->
      <template v-else>
        <button
          v-for="e in favs"
          :key="e.id"
          @click="emit('open', e)"
          class="glass w-full rounded-2xl p-3 flex items-center gap-3 text-left hover:brightness-110"
        >
          <img
            :src="rowSrc(e)"
            loading="lazy"
            decoding="async"
            @error="onImgError(e)"
            class="h-12 w-12 rounded-xl object-cover bg-mist-800/40 shrink-0"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-mist-text line-clamp-1">{{ e.city || e.address || '（无地址）' }}</p>
            <p class="text-xs text-mist-muted line-clamp-1">{{ e.description }}</p>
          </div>
          <StarIcon filled class="w-4 h-4 text-amber-500 shrink-0" />
        </button>
      </template>

      <!-- empty state for whichever section is active -->
      <p
        v-if="!sections.find((s) => s.key === section).count"
        class="glass rounded-2xl py-8 text-center text-xs text-mist-muted/70"
      >
        {{ emptyText[section] }}
      </p>
    </section>
  </div>
</template>
