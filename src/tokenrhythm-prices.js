/**
 * 基元律动（tokenrhythm.studio）官方模型固定价（¥/M token）。
 * 价格取自官方 models 页（2026-08-28 抓取）：输入 / 输出 / 缓存命中，一律取 effective 实付价。
 *
 * 说明：
 * 1. 未公布缓存命中价的模型（mimo / minimax 系列）以输入价兜底，保守不低估。
 * 2. 与内置 PINNED_V4_MODELS 同名的模型（deepseek-v4-flash / pro）必须显式写出
 *    peak=offPeak=同值，否则会被 pricing.js 内置官方峰谷表覆盖。
 * 3. 带折扣的模型取 effective 实付价（deepseek-v4-pro / qwen3.7-max / glm-5.3-flash）。
 * 4. 图像模型（qwen-image-2.0 / wan2.7-image）按张计费 0.2 元，不入 token 计价，不在此表。
 */

const RATES = {
  'deepseek-v4-flash': { cacheHit: 0.2, cacheMiss: 1, output: 2 },
  'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
  'deepseek-v4-flash-0731': { cacheHit: 0.1, cacheMiss: 3, output: 9 },
  'deepseek-v4-pro-0813': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
  'glm-5': { cacheHit: 1.5, cacheMiss: 6, output: 22 },
  'glm-5.1': { cacheHit: 2, cacheMiss: 8, output: 28 },
  'glm-5.2': { cacheHit: 2, cacheMiss: 8, output: 28 },
  'glm-5.3': { cacheHit: 2, cacheMiss: 8, output: 28 },
  'glm-5.3-flash': { cacheHit: 0.115, cacheMiss: 0.4, output: 1.4 },
  'seed-2.1-pro': { cacheHit: 1.2, cacheMiss: 6, output: 30 },
  'seed-2.1-turbo': { cacheHit: 0.6, cacheMiss: 3, output: 15 },
  'kimi-k2.5': { cacheHit: 0.8, cacheMiss: 4, output: 21 },
  'kimi-k2.6': { cacheHit: 1.3, cacheMiss: 6.5, output: 27 },
  'kimi-k2.7-code': { cacheHit: 1.3, cacheMiss: 6.5, output: 27 },
  'longcat-2.0': { cacheHit: 0.1, cacheMiss: 5, output: 20 },
  'mimo-v2.5-pro': { cacheHit: 3, cacheMiss: 3, output: 6 },
  'minimax-m2.5': { cacheHit: 2.1, cacheMiss: 2.1, output: 8.4 },
  'minimax-m2.7': { cacheHit: 2.1, cacheMiss: 2.1, output: 8.4 },
  'qwen3.7-flash': { cacheHit: 0.24, cacheMiss: 1.2, output: 4.8 },
  'qwen3.7-max': { cacheHit: 1.2, cacheMiss: 6, output: 18 },
  'qwen3.8-27b': { cacheHit: 0.6, cacheMiss: 3, output: 12 },
  'qwen3.8-max': { cacheHit: 1.5, cacheMiss: 12, output: 36 },
}

/** 锁定全天固定价：peak=offPeak=同值，避免被内置峰谷表覆盖。 */
const lockFlat = (r) => ({
  ...r,
  peak: { ...r },
  offPeak: { ...r },
})

export const TOKENRHYTHM_MODEL_IDS = Object.keys(RATES)

/** 基元律动 22 个 token 计费模型价格表（另 2 个图像模型按张计费，不在此表） → 顶级 prices 可直接使用的配置（ModelPrice 结构）。 */
export const tokenrhythmConfigPrices = () =>
  Object.fromEntries(Object.entries(RATES).map(([model, r]) => [model, lockFlat(r)]))

/** 渠道级配置：providerPrices['tokenrhythm'] 可直接引用的表。 */
export const tokenrhythmProviderPrices = () => ({ tokenrhythm: tokenrhythmConfigPrices() })