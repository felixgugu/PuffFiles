<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useDragStore } from "@/stores/drag";
import { formatCount } from "@/utils/format";
import { fileNameOf } from "@/utils/path";

/**
 * 拖曳時跟著游標跑的殘影（見 AGENTS.md「檔案拖曳移動」）。
 *
 * 對標檔案總管：單一項目顯示檔名，多選顯示「N 個項目」；第二行說明放開會做什麼
 *（移動／複製到哪個資料夾、或為什麼不能放）。`pointer-events: none` 是必要條件 ——
 * 命中判定用 `elementFromPoint`，殘影擋在游標底下就什麼都放不進去。
 */
const drag = useDragStore();

const single = computed(() => (drag.sources.length === 1 ? drag.sources[0] : null));
const label = computed(() =>
  single.value
    ? fileNameOf(single.value.path) || single.value.path
    : `${formatCount(drag.sources.length)} 個項目`,
);
const icon = computed(() => (single.value?.isDir ? "folder" : "file"));

const action = computed(() => {
  if (!drag.hover) {
    return "拖曳到資料夾或另一個窗格";
  }
  if (drag.effect === "none") {
    return drag.rejectReason || "不能放到這裡";
  }
  const name = fileNameOf(drag.hover.path) || drag.hover.path;
  return `${drag.effect === "copy" ? "複製" : "移動"}到「${name}」`;
});

/** 靠近視窗右／下緣時往另一邊翻，殘影不會被切掉。 */
const style = computed(() => {
  const { x, y } = drag.point;
  const flipX = typeof window !== "undefined" && x > window.innerWidth - 280;
  const flipY = typeof window !== "undefined" && y > window.innerHeight - 110;
  return {
    left: `${x}px`,
    top: `${y}px`,
    transform: `translate(${flipX ? "calc(-100% - 14px)" : "14px"}, ${
      flipY ? "calc(-100% - 12px)" : "12px"
    })`,
  };
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="drag.active"
      class="pointer-events-none fixed z-[60] max-w-[280px] rounded-xl border border-line bg-surface/95 px-2.5 py-1.5 shadow-lg"
      :style="style"
      aria-hidden="true"
    >
      <div class="flex min-w-0 items-center gap-2">
        <AppIcon :name="icon" :size="15" class="shrink-0 text-accent" />
        <span class="min-w-0 truncate text-sm font-medium text-ink">{{ label }}</span>
      </div>
      <p class="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-muted">
        <AppIcon
          v-if="drag.hover && drag.effect !== 'none'"
          :name="drag.effect === 'copy' ? 'copy' : 'move'"
          :size="12"
          class="shrink-0"
        />
        <span class="min-w-0 truncate">{{ action }}</span>
      </p>
    </div>
  </Teleport>
</template>
