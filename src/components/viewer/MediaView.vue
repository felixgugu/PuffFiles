<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useExplorerStore } from "@/stores/explorer";
import { useViewerStore } from "@/stores/viewer";
import type { PaneId } from "@/types/fs";
import { formatBytes } from "@/utils/format";

/**
 * 聲音與影片檢視器（原生播放器）。
 *
 * 內容不經過 IPC：`stores/viewer.ts` 用自訂協定 `stream` 取得 token，這裡只把
 * `state.streamUrl` 交給 `<audio>`／`<video>`。後端支援 HTTP Range，拖動進度條時
 * 只讀需要的那一段；媒體的單次回應有上限，不會一次把整部影片讀進記憶體。
 *
 * **不自動播放**：開啟後停住，按播放才出聲（瀏覽器政策與不打擾使用者）。
 * 切分頁或換檔時檢視器會卸載，`onBeforeUnmount` 先把媒體暫停，聲音不會留著。
 */
const props = defineProps<{ paneId: PaneId }>();

const viewer = useViewerStore();
const explorer = useExplorerStore();

const state = computed(() => viewer.of(props.paneId));
const isVideo = computed(() => state.value?.kind === "video");
const media = useTemplateRef<HTMLMediaElement>("media");
const failed = ref(false);

function onError() {
  failed.value = true;
}

function onLoaded() {
  failed.value = false;
}

/** 重新整理（F5）會換一組 token；新的來源就不該還停在錯誤畫面。 */
watch(
  () => state.value?.streamUrl,
  () => {
    failed.value = false;
  },
);

onBeforeUnmount(() => {
  media.value?.pause();
});

function openExternally() {
  const path = state.value?.path;
  if (path) {
    void explorer.openPath(path);
  }
}
</script>

<template>
  <div
    v-if="state?.streamUrl"
    class="relative flex min-h-0 min-w-0 flex-1 flex-col"
    :class="failed ? 'bg-canvas' : isVideo ? 'bg-black' : 'bg-canvas'"
  >
    <!-- 容器支援不了的編碼（例如沒有系統擴充的 HEVC）：不要只留一片黑。 -->
    <div
      v-if="failed"
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <AppIcon name="info" :size="22" class="text-ink-faint" />
      <p class="text-sm text-ink-muted">這個格式 WebView2 播不出來（可能是編解碼不支援）</p>
      <button
        type="button"
        class="mt-1 flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-sm text-ink pressable hover:bg-surface-hover active:bg-pressed"
        @click="openExternally"
      >
        <AppIcon name="externalLink" :size="13" />
        用預設程式開啟
      </button>
    </div>

    <video
      v-else-if="isVideo"
      ref="media"
      :key="state.streamUrl"
      :src="state.streamUrl"
      class="min-h-0 w-full flex-1 object-contain"
      controls
      playsinline
      preload="metadata"
      @loadedmetadata="onLoaded"
      @error="onError"
    />

    <div v-else class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
      <AppIcon name="music" :size="40" class="text-ink-faint" />
      <div class="max-w-md min-w-0 text-center">
        <p class="truncate text-sm font-medium text-ink" :title="state.name">{{ state.name }}</p>
        <p class="mt-0.5 text-xs text-ink-faint">{{ formatBytes(state.size) }}</p>
      </div>
      <audio
        ref="media"
        :key="state.streamUrl"
        :src="state.streamUrl"
        class="w-full max-w-md"
        controls
        preload="metadata"
        @loadedmetadata="onLoaded"
        @error="onError"
      />
    </div>
  </div>
</template>
