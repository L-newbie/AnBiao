<script setup>
import { computed, ref } from 'vue'
import Avatar from '../components/Avatar.vue'
import DeleteButton from '../components/DeleteButton.vue'
import StarIcon from '../components/StarIcon.vue'
import { config } from '../lib/config.js'
import { getDeviceId, getPoeticName, maskedDeviceCode, uploadsToday, remainingToday } from '../lib/device.js'
import { favoriteEntries } from '../lib/favorites.js'
import { imageSrc, listSrc } from '../lib/images.js'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  myComments: { type: Array, default: () => [] },
})
const emit = defineEmits(['open', 'deleted', 'comment-deleted'])

// Last delete failure, shown under the list. Cleared on the next attempt.
// Shared by both sections — only one is on screen at a time.
const delErr = ref('')
function onDeleted(id) {
  delErr.value = ''
  emit('deleted', id)
}
function onDeleteError(msg) {
  delErr.value = msg
}
function onCommentDeleted(id) {
  delErr.value = ''
  emit('comment-deleted', id)
}

const id = getDeviceId()
const poeticName = getPoeticName(id)
const code = maskedDeviceCode(id)

const mine = computed(() => props.entries.filter((e) => e.deviceId === id))
// favoriteEntries reads the shared reactive `favorites` ref, so un-starring an
// entry from this list drops it here immediately.
const favs = computed(() => favoriteEntries(props.entries))
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

// Where each of my comments landed — for the card subtitle + jump target.
function entryOf(comment) {
  return props.entries.find((e) => e.id === comment.entryId)
}

function openComment(comment) {
  const entry = entryOf(comment)
  // Only openable if the entry itself is live in the feed. A pending comment
  // on an entry we can't see (or one not yet aggregated) has nowhere to go.
  if (entry) emit('open', entry)
}
</script>

<template>
  <div class="space-y-5 pt-6">
    <!-- identity card -->
    <section class="glass rounded-3xl p-6 flex flex-col items-center text-center gap-3">
      <Avatar :device-id="id" :size="84" />
      <h2 class="font-serif text-2xl text-mist-text">{{ poeticName }}</h2>
      <p class="font-mono text-xs text-mist-muted/70 tracking-widest">{{ code }}</p>
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
            v-if="e._local"
            class="rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5 shrink-0"
          >等待通过</span>
          <DeleteButton :entry-id="e.id" @deleted="onDeleted" @error="onDeleteError" />
        </div>
        <p v-if="delErr" class="text-[11px] text-rose-glow px-1">{{ delErr }}</p>
      </template>

      <!-- 留言 (live + still-pending ones, flagged 等待通过) — a plain div for
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
            :disabled="!entryOf(c)"
            class="text-left min-w-0 flex-1 hover:brightness-110 disabled:opacity-60 disabled:cursor-default"
          >
            <p class="text-sm text-mist-muted leading-relaxed line-clamp-2 break-all">{{ c.text }}</p>
            <p class="text-xs text-mist-muted/70 mt-1 line-clamp-1">
              {{ commentTime(c) }} · {{ entryOf(c) ? (entryOf(c).city || entryOf(c).address || '该记录') : '记录待审核' }}
            </p>
          </button>
          <span
            v-if="c._local"
            class="rounded-full bg-amber-500/80 text-white text-[10px] px-2 py-0.5 shrink-0"
          >等待通过</span>
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
