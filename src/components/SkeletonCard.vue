// Feed loading-placeholder card — a frosted-glass shape with a sweeping
// shimmer so the initial fetch reads as "content incoming", not a white hole.
<script setup>
// Purely presentational; sized to match EntryCard (image ~h-40 + 2 text rows).
</script>

<template>
  <div class="glass rounded-2xl overflow-hidden">
    <div class="skeleton-shimmer h-40 w-full"></div>
    <div class="p-3 space-y-2">
      <div class="skeleton-shimmer h-3.5 w-4/5 rounded"></div>
      <div class="skeleton-shimmer h-3 w-3/5 rounded"></div>
      <div class="skeleton-shimmer h-2.5 w-2/5 rounded"></div>
    </div>
  </div>
</template>
