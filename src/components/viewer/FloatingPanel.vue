<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import type { IconName } from "@/components/common/icons";
import { useViewerPanel } from "@/composables/useViewerPanel";
import { useSettingsStore } from "@/stores/settings";
import type { PanelLayout } from "@/utils/viewerPanel";

/**
 * 檢視器浮動面板的外殼：標題列（圖示＋名稱＋動作＋收合鈕）、拖曳移動、
 * 左下角縮放把手、半透明材質。目錄索引與搜尋面板共用這一層，
 * 內容由預設插槽決定；位置、尺寸與收合狀態由呼叫端接上設定。
 *
 * `peek` 是目錄索引專用的顯示模式（見 `OutlinePanel`）：平常收成一顆圓形泡泡，
 * 滑鼠移進來（或鍵盤焦點進入）才展開，移開就收回去；標題列的釘選鈕可以固定展開。
 * 泡泡與展開是**同一個元素**（泡泡就是標題列）—— 展開時焦點不會掉到 body，
 * Tab 才走得進清單，游標也不會因為「換了一個元素」被判定成離開。
 */
const props = defineProps<{
  /** 所在的窗格；與 `panel` 組成面板的身分（互相避讓時要比對）。 */
  paneId: string;
  /** 面板識別碼（`toc`／`search`），同時給測試與「面板互相避讓」查詢用。 */
  panel: string;
  title: string;
  icon: IconName;
  /** 標題列的無障礙說明（含「可拖曳移動、方向鍵移動」等提示）。 */
  dragLabel: string;
  /** 縮放把手的無障礙說明。 */
  resizeLabel: string;
  /** 定位容器（檢視器根節點）。 */
  host: HTMLElement | null;
  collapsed: boolean;
  /**
   * 圓形泡泡模式：收合時只留 36×36 的圓形圖示，滑過／聚焦才展開。
   *
   * 有開啟時 `collapsed` 不再當成外觀狀態（內容永遠準備好），由這裡的
   * hover／焦點／釘選決定要不要展開。
   */
  peek?: boolean;
  /** 釘選：維持展開；只有 `peek` 模式有這顆按鈕。 */
  pinned?: boolean;
  /** 開始時的記憶值。 */
  initialLayout: PanelLayout;
  /** 內容自然高度（呼叫端量自己的捲動區）。 */
  contentHeight: number;
  /** 未移動過時要避開的另一個浮動面板身分（`<paneId>:<panel>`）。 */
  avoidId?: string;
  /**
   * 面板配色跟隨**底下的內容**而不是佈景主題：`true` 時改用淺色權杖
   * （DOCX 的頁面固定白紙，深色主題的深色面板疊上去字會看不見）。
   */
  light?: boolean;
}>();

const emit = defineEmits<{
  persist: [layout: PanelLayout];
  toggleCollapse: [];
  /** 釘選／取消釘選（只有 `peek` 模式）。 */
  togglePin: [];
}>();

const settings = useSettingsStore();

/** 指標在面板裡。 */
const pointerInside = ref(false);
/** 鍵盤焦點在面板裡（只認 `:focus-visible`，滑鼠點按鈕不算）。 */
const focusInside = ref(false);
/** 使用者主動收合（點目錄項目、Enter、Esc）：先壓住 hover 展開，等離開再進來才恢復。 */
const dismissed = ref(false);
const rootEl = useTemplateRef<HTMLElement>("root");
const titleEl = useTemplateRef<HTMLElement>("title");

/**
 * 有沒有展開。
 *
 * 非圓形模式就是原本的「沒有收合」；圓形模式由釘選、指標／鍵盤焦點、以及使用者
 * 剛剛是否主動收合決定（`dismissed` 會擋住 hover，直到他真的離開面板再回來）。
 */
const expanded = computed(() => {
  if (!props.peek) {
    return !props.collapsed;
  }
  if (props.pinned === true) {
    return true;
  }
  return (pointerInside.value || focusInside.value) && !dismissed.value;
});

/** 收成圓形泡泡：只剩標題列中間的圖示。 */
const bubble = computed(() => props.peek === true && !expanded.value);

const { rect, panelStyle, moving, resizing, onTitlePointerDown, onTitleKeydown, onResizePointerDown, onResizeKeydown } =
  useViewerPanel({
    id: `${props.paneId}:${props.panel}`,
    host: () => props.host,
    contentHeight: computed(() => props.contentHeight),
    collapsed: computed(() => props.collapsed),
    bubble,
    initialLayout: props.initialLayout,
    onPersist: (layout) => emit("persist", layout),
    onToggleCollapse: () => emit("toggleCollapse"),
    avoidId: props.avoidId,
  });

/** 泡泡沒有拖曳語意（按下＝打開），無障礙說明就不該說「可拖曳移動」。 */
const headerLabel = computed(() =>
  bubble.value ? `${props.title}，目前收合；按 Enter 或點擊展開` : props.dragLabel,
);

function onPointerEnter() {
  if (!props.peek) {
    return;
  }
  pointerInside.value = true;
  dismissed.value = false;
}

function onPointerLeave() {
  if (!props.peek) {
    return;
  }
  // 拖曳／縮放中不收（指標被 pointer capture 抓住時不會觸發，放開之後才會補上）。
  if (moving.value || resizing.value) {
    return;
  }
  // 立刻收：不留延遲、也不做縮小／淡出（泡泡本身是清楚的圓形，直接切過去就行）。
  // 釘選時只是記下「指標不在裡面」，解除釘選時才知道要收回。
  pointerInside.value = false;
}

/** 只有鍵盤造成的焦點才展開（滑鼠按下按鈕時 Chrome 會把焦點放上去，不該因此固定展開）。 */
function onFocusIn(event: FocusEvent) {
  if (!props.peek) {
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(":focus-visible")) {
    return;
  }
  focusInside.value = true;
}

function onFocusOut(event: FocusEvent) {
  if (!props.peek) {
    return;
  }
  const next = event.relatedTarget;
  if (next instanceof Node && rootEl.value?.contains(next)) {
    return;
  }
  // 一樣要記下來：釘選只是不讓它收，解除釘選時焦點已經不在面板裡了。
  focusInside.value = false;
  if (!pointerInside.value) {
    dismissed.value = false;
  }
}

/**
 * 立即收合成泡泡（點目錄項目時由 `OutlinePanel` 呼叫）。
 *
 * 釘選時不動 —— 釘選的意思就是維持展開。收合後把焦點放回泡泡（也就是標題列），
 * 鍵盤使用者才有辦法再按 Enter 打開。
 */
function collapsePeek() {
  if (!props.peek || props.pinned) {
    return;
  }
  dismissed.value = true;
  titleEl.value?.focus({ preventScroll: true });
}

/** Enter／Esc：明確要求收合，釘選也一起取消（否則下一個影格又會展開）。 */
function dismissPeek() {
  if (!props.peek) {
    return;
  }
  if (props.pinned) {
    emit("togglePin");
  }
  dismissed.value = true;
  titleEl.value?.focus({ preventScroll: true });
}

function togglePeek() {
  if (expanded.value) {
    dismissPeek();
    return;
  }
  dismissed.value = false;
  // 用鍵盤打開時焦點本來就在標題列上；這裡只把「展開」補上。
  focusInside.value = true;
}

/**
 * 泡泡只有 36px、又貼在展開矩形的角落，拖它會用展開的邊界去夾位置（手感會很怪）；
 * 所以泡泡上的按下只有一個意思：打開。
 */
function onHeaderPointerDown(event: PointerEvent) {
  if (bubble.value) {
    event.preventDefault();
    dismissed.value = false;
    pointerInside.value = true;
    return;
  }
  onTitlePointerDown(event);
}

/** 圓形模式下 Enter／空白＝切換展開；其餘按鍵（方向鍵移動）照舊交給 `useViewerPanel`。 */
function onHeaderKeydown(event: KeyboardEvent) {
  if (event.target !== event.currentTarget) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (props.peek) {
      togglePeek();
    } else {
      emit("toggleCollapse");
    }
    return;
  }
  // 泡泡沒有拖曳語意（見 `onHeaderPointerDown`），方向鍵也不在這裡移動它。
  if (bubble.value) {
    return;
  }
  onTitleKeydown(event);
}

/**
 * 面板裡的 Esc＝先把目錄收起來，不要直接關掉檢視器。
 *
 * 全域的 Esc（關搜尋面板／關檢視器）掛在 window，這裡 `stopPropagation` 才攔得住。
 */
function onRootKeydown(event: KeyboardEvent) {
  if (!props.peek || bubble.value || event.key !== "Escape") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  dismissPeek();
}

defineExpose({ collapsePeek });
</script>

<template>
  <div
    v-if="rect"
    ref="root"
    :data-panel="panel"
    class="viewer-panel absolute z-30 flex flex-col overflow-hidden text-base"
    :class="{
      'is-active': moving || resizing,
      'is-peek': peek,
      'is-bubble': bubble,
      'is-pinned': peek && pinned && !bubble,
      'rounded-full': bubble,
      'rounded-xl': !bubble,
      'panel-light': light,
    }"
    :style="{ ...panelStyle, '--panel-opacity': `${settings.viewerPanelOpacity}%` }"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @keydown="onRootKeydown"
  >
    <div
      ref="title"
      class="flex shrink-0 items-center"
      :class="[
        bubble ? 'size-full justify-center' : 'h-8 gap-1 border-b px-2.5',
        !bubble && !collapsed ? 'border-line' : '',
        moving ? 'cursor-grabbing' : bubble ? 'cursor-pointer' : 'cursor-grab',
      ]"
      tabindex="0"
      :aria-label="headerLabel"
      :aria-expanded="peek ? expanded : undefined"
      @pointerdown="onHeaderPointerDown"
      @keydown="onHeaderKeydown"
    >
      <AppIcon :name="icon" :size="bubble ? 16 : 14" class="text-ink-muted" />
      <span v-if="!bubble" class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
        {{ title }}
      </span>
      <!-- 面板自己的動作（例如書籤的「加入書籤」）；沒有就不佔位。 -->
      <slot v-if="!bubble" name="actions" />
      <!-- 釘選：釘住後不因滑鼠移開而收合（圓形模式才有）。 -->
      <button
        v-if="peek && !bubble"
        type="button"
        class="flex size-6 shrink-0 items-center justify-center rounded-md pressable"
        :class="
          pinned
            ? 'bg-accent-soft text-accent'
            : 'text-ink-muted hover:bg-surface-hover active:bg-pressed hover:text-ink'
        "
        :title="pinned ? `取消釘選${title}` : `釘選${title}（維持展開）`"
        :aria-label="pinned ? `取消釘選${title}` : `釘選${title}，維持展開`"
        :aria-pressed="pinned"
        @click="emit('togglePin')"
      >
        <AppIcon name="pin" :size="14" />
      </button>
      <button
        v-if="!peek"
        type="button"
        class="flex size-6 items-center justify-center rounded-md text-ink-muted pressable hover:bg-surface-hover active:bg-pressed hover:text-ink"
        :title="collapsed ? `展開${title}` : `收合${title}`"
        :aria-expanded="!collapsed"
        @click="emit('toggleCollapse')"
      >
        <AppIcon :name="collapsed ? 'chevronDown' : 'chevronUp'" :size="14" />
      </button>
    </div>

    <div v-if="expanded" class="flex min-h-0 flex-1 flex-col">
      <slot />
    </div>

    <div
      v-if="expanded"
      class="absolute bottom-0 left-0 flex size-6 cursor-nesw-resize items-end justify-start pl-1 pb-1"
      :class="resizing ? 'text-accent' : 'text-ink-faint'"
      role="separator"
      :aria-label="resizeLabel"
      tabindex="0"
      @pointerdown="onResizePointerDown"
      @keydown="onResizeKeydown"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M9 9 1 1" />
        <path d="M5 9 1 5" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
/*
 * 半透明底色 + 背景模糊：看得見底下的內文，但文字對比仍然足夠。
 * 不透明度由設定值餵進 `--panel-opacity`；系統要求減少透明度時改回不透明。
 *
 * 沒有滑鼠移過、鍵盤焦點也不在面板裡時，整塊幾乎隱形（也一起關掉模糊）：
 * 面板浮在內文上，平常不該擋住閱讀，只留一點淡淡的輪廓提醒它還在。
 * 移上去、焦點進入，或正在拖曳／縮放時才回到設定的材質。
 */
.viewer-panel {
  background: color-mix(in oklab, var(--color-menu) var(--panel-opacity, 50%), transparent);
  border: 1px solid var(--color-line);
  box-shadow:
    0 0 0 0.5px var(--color-hairline-bright) inset,
    0 12px 28px -8px oklch(0 0 0 / 0.28),
    0 2px 8px -2px oklch(0 0 0 / 0.18);
  backdrop-filter: blur(0);
  opacity: var(--panel-idle-opacity, 0.2);
  transition:
    opacity 160ms ease,
    backdrop-filter 160ms ease;
}

.viewer-panel:hover,
.viewer-panel:focus-within,
.viewer-panel.is-active {
  opacity: 1;
  /* 不透明度可以調到 50%，模糊要夠強才不會讓底下的文字穿過來干擾閱讀。 */
  backdrop-filter: blur(16px);
}

/*
 * 圓形模式（目錄索引）整組不參與 idle 的半透明：泡泡是唯一入口，淡到 0.2 等於找不到；
 * 展開時也一樣 —— 滑鼠一離開就立刻收成泡泡，中間不該再插一段「先淡掉、再彈回清楚」。
 * 釘選同理：那正是「就算沒有 hover 也維持展開」。
 */
.viewer-panel.is-peek,
.viewer-panel.is-bubble,
.viewer-panel.is-pinned {
  opacity: 1;
  backdrop-filter: blur(16px);
}

/*
 * 泡泡的焦點框：外框會被 `overflow: hidden`（圓形）裁掉，改成內縮的一圈 accent。
 * 用 `:has(:focus-visible)` 才不會連滑鼠點過之後的程式化聚焦也亮一圈。
 */
.viewer-panel.is-bubble:has(:focus-visible) {
  box-shadow:
    0 0 0 2px var(--color-accent) inset,
    0 12px 28px -8px oklch(0 0 0 / 0.28),
    0 2px 8px -2px oklch(0 0 0 / 0.18);
}

/*
 * 展開時的尺寸過場（從泡泡長成面板）。
 *
 * 收合的變化後樣式是 `.is-bubble`（沒有這條 transition），所以**收合直接就位** ——
 * 不縮小、也不淡出，切過去就是圓形。拖曳與縮放中同樣不轉場（會跟不上指標）；
 * `reduce-motion` 由 `main.css` 統一把時間壓成 1ms。
 */
.viewer-panel.is-peek:not(.is-bubble):not(.is-active) {
  transition:
    width 140ms cubic-bezier(0.22, 0.61, 0.36, 1),
    height 140ms cubic-bezier(0.22, 0.61, 0.36, 1),
    border-radius 140ms cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 160ms ease,
    backdrop-filter 160ms ease;
}

@media (prefers-reduced-transparency: reduce) {
  .viewer-panel {
    background: var(--color-menu);
    backdrop-filter: none;
  }
}
</style>
