import { onScopeDispose, ref, type Ref } from "vue";
import { SPRINGS, isSettled, springStep, type SpringConfig, type SpringState } from "@/utils/spring";
import { useSettingsStore } from "@/stores/settings";

export interface SpringHandle {
  /** 目前畫面上的值（動畫進行中會逐幀更新）。 */
  value: Ref<number>;
  /** 動到目標值；可帶入初始速度做到「速度交接」。 */
  set: (target: number, velocity?: number) => void;
  /** 立刻跳到目標值（不播動畫）。 */
  jump: (target: number) => void;
  stop: () => void;
}

/**
 * 以 rAF 驅動的單一數值彈簧。
 *
 * 永遠從「目前畫面值」重新起算，所以任何時候打斷都不會跳動 ——
 * 這是 Apple 所說 interruptibility 的最小實作。
 */
export function useSpringValue(
  initial: number,
  config: SpringConfig = SPRINGS.ui,
): SpringHandle {
  const settings = useSettingsStore();
  const value = ref(initial);
  const state: SpringState = { value: initial, velocity: 0 };

  let target = initial;
  let frame = 0;
  let previous = 0;

  function tick(now: number) {
    const dt = Math.min(Math.max((now - previous) / 1000, 1 / 240), 1 / 30);
    previous = now;

    const next = springStep(state, target, config, dt);
    state.value = next.value;
    state.velocity = next.velocity;
    value.value = next.value;

    if (isSettled(state, target)) {
      state.value = target;
      state.velocity = 0;
      value.value = target;
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function start() {
    if (frame) {
      return;
    }
    previous = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function set(nextTarget: number, velocity = 0) {
    target = nextTarget;
    if (settings.reduceMotion) {
      jump(nextTarget);
      return;
    }
    // 速度交接：接手的人從上一段動作留下的速度繼續。
    state.velocity = velocity;
    state.value = value.value;
    start();
  }

  function jump(nextTarget: number) {
    stop();
    target = nextTarget;
    state.value = nextTarget;
    state.velocity = 0;
    value.value = nextTarget;
  }

  function stop() {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  onScopeDispose(stop);

  return { value, set, jump, stop };
}
