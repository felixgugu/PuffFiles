<script setup lang="ts">
import { SHORTCUT_GROUPS } from "@/utils/shortcuts";

/**
 * 快速鍵一覽（設定頁「關於」用）。
 *
 * 只負責呈現；資料在 `utils/shortcuts.ts`，實際行為在 `useKeyboardShortcuts.ts`，
 * 三者要一起維護。
 */
</script>

<template>
  <div>
    <h4 class="text-sm font-medium text-ink">快速鍵</h4>
    <div class="mt-2 space-y-4">
      <section v-for="group in SHORTCUT_GROUPS" :key="group.title">
        <p class="text-xs font-medium text-ink-faint">{{ group.title }}</p>
        <p v-if="group.note" class="mt-0.5 text-xs leading-relaxed text-ink-faint">
          {{ group.note }}
        </p>
        <dl class="mt-1.5 space-y-1">
          <div
            v-for="row in group.items"
            :key="`${group.title}:${row.keys.join('+')}`"
            class="flex items-baseline gap-3"
          >
            <dt class="flex w-44 shrink-0 flex-wrap items-center gap-1">
              <template v-for="(chord, index) in row.keys" :key="chord">
                <span v-if="index > 0" class="text-2xs text-ink-faint">/</span>
                <kbd
                  v-for="key in chord.split('+')"
                  :key="key"
                  class="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-2xs leading-none text-ink"
                >
                  {{ key }}
                </kbd>
              </template>
            </dt>
            <dd class="min-w-0 text-sm leading-relaxed text-ink-muted">{{ row.label }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>
