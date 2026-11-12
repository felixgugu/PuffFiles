<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { MenuItem } from "@/types/menu";

/**
 * 右鍵選單的「一層」：材質面板＋一列列項目。
 *
 * 父選單與子選單共用同一個元件，量測、定位與開關都交給 `ContextMenu`
 * （它才知道游標停在哪一列、面板還放不放得下）；這裡只畫出項目，
 * 把滑過與選取往上送，兩層的樣式與鍵盤行為才不會各走各的。
 */
const props = defineProps<{
  items: MenuItem[];
  /** 面板的最大高度（px）；超過就在面板內捲動。 */
  maxHeight: number;
  /** 目前展開中的子選單入口；那一列保持高亮（與 Windows 選單一致）。 */
  activeId?: string;
}>();

const emit = defineEmits<{
  select: [id: string];
  hover: [item: MenuItem, event: PointerEvent];
}>();

const visible = computed(() => props.items.filter((item) => item.id !== ""));

function hasChildren(item: MenuItem): boolean {
  return !!item.children?.length;
}

function onRowSelect(item: MenuItem) {
  if (item.disabled) {
    return;
  }
  // 子選單入口不是動作：按下去只維持展開，真正的事件一律由子選單裡的葉節點發出，
  // id 與攤平時完全相同（`tool:<id>`），呼叫端不必分辨這一項是從哪一層按的。
  if (!hasChildren(item)) {
    emit("select", item.id);
  }
}
</script>

<template>
  <div
    class="material-menu scroll-area min-w-52 overflow-y-auto overscroll-contain rounded-lg py-1"
    :style="{ maxHeight: `${maxHeight}px` }"
  >
    <template v-for="item in visible" :key="item.id">
      <div v-if="item.separatorBefore" class="my-0.5 h-px bg-line" />
      <button
        type="button"
        class="group flex w-full items-center gap-2.5 px-2.5 py-1 text-left text-sm pressable disabled:opacity-40"
        :class="
          item.disabled
            ? 'text-ink-faint'
            : item.id === activeId
              ? 'bg-accent text-accent-ink'
              : 'text-ink hover:bg-accent hover:text-accent-ink'
        "
        :disabled="item.disabled"
        :aria-haspopup="hasChildren(item) ? 'menu' : undefined"
        :aria-expanded="hasChildren(item) ? item.id === activeId : undefined"
        @pointerenter="emit('hover', item, $event)"
        @click="onRowSelect(item)"
      >
        <AppIcon v-if="item.icon" :name="item.icon" :size="14" class="shrink-0 opacity-80" />
        <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
        <!--
          快速鍵提示用 ink-faint（不疊透明度）：疊透明度會把它洗成 <4.5:1 的灰，
          在白色選單底上讀不清楚；滑過（accent 底）時跟著變成 accent-ink。
        -->
        <span
          v-if="item.shortcut"
          class="shrink-0 text-2xs"
          :class="item.id === activeId ? 'text-accent-ink' : 'text-ink-faint group-hover:text-accent-ink'"
        >{{ item.shortcut }}</span>
        <AppIcon
          v-if="hasChildren(item)"
          name="chevronRight"
          :size="13"
          class="shrink-0 opacity-70"
        />
      </button>
    </template>
  </div>
</template>
