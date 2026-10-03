/**
 * 純數學的 spring / 動量工具（無副作用、不依賴 Vue）。
 *
 * 參數刻意對齊 Apple 在《Designing Fluid Interfaces》使用的兩個設計師友善維度：
 * - `damping`：阻尼比。1.0 = 臨界阻尼（不過衝），< 1 才會回彈。
 * - `response`：反應速度（秒）。越小越靈敏；這不是「時長」。
 */

export interface SpringConfig {
  damping: number;
  response: number;
}

export interface SpringState {
  value: number;
  velocity: number;
}

/** 全站共用的彈簧語彙，避免每個元件各自發明一組數字。 */
export const SPRINGS = {
  /** 一般 UI 位移：不過衝。 */
  ui: { damping: 1, response: 0.3 },
  /** 樹節點展開／收合。 */
  tree: { damping: 1, response: 0.3 },
  /** 窗格分割與收合。 */
  pane: { damping: 1, response: 0.35 },
  /** 面板／窗格展開收合：比分割線再快一點。 */
  panel: { damping: 1, response: 0.32 },
  /** 分頁切換。 */
  tab: { damping: 1, response: 0.25 },
  /** 拖曳放開後的吸附。 */
  settle: { damping: 1, response: 0.4 },
  /** 選單材質化。 */
  menu: { damping: 1, response: 0.25 },
  /** 側邊面板進出。 */
  sheet: { damping: 0.9, response: 0.35 },
  /** 帶動量的互動（甩動）才允許回彈。 */
  momentum: { damping: 0.8, response: 0.35 },
} as const satisfies Record<string, SpringConfig>;

const SUBSTEP = 1 / 240;

/**
 * 以半隱式歐拉法推進一個彈簧。
 *
 * `dt` 會先被切成固定子步，避免掉格時數值爆炸（甩出去而不是收回來）。
 */
export function springStep(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  const omega = (2 * Math.PI) / Math.max(config.response, 0.05);
  const stiffness = omega * omega;
  const damping = 2 * config.damping * omega;

  let { value, velocity } = state;
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const step = dt / steps;

  for (let index = 0; index < steps; index += 1) {
    const acceleration = -stiffness * (value - target) - damping * velocity;
    velocity += acceleration * step;
    value += velocity * step;
  }

  return { value, velocity };
}

export function isSettled(state: SpringState, target: number, epsilon = 0.001): boolean {
  return Math.abs(state.value - target) < epsilon && Math.abs(state.velocity) < epsilon;
}

/** 邊界橡皮筋：越過邊界越多，跟隨越少。 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) {
    return 0;
  }
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
