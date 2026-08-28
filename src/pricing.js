/**
 * DeepSeek V4 自 2026-08-17 起按北京时间走峰谷价。
 * CNY / USD 是两套官方价目，不是汇率换算；峰谷时段两边同步切换。
 * USD 官方价 = CNY 官方价 × 0.14（与刊例 1 / 0.14、2 / 0.28 一致）。
 * 高峰：北京时间周一至周五 09:00–12:00、14:00–18:00；其余（含周末）为低谷，低谷 = 高峰 × 0.5。
 * 峰谷执行规则官方分两阶段：
 *   ① 2026-08-17 00:00（北京）起实行峰谷定价，周末也是峰谷（与工作日同规则）；
 *   ② 2026-08-23 00:00（北京，含）起，周末全天谷价（工作日峰谷不变）。
 * 设置里的 prices[model].peak / .offPeak 可覆盖官方峰谷。
 * 内置 flash / pro / vision-exp 若只有刊例三字段，仍走官方峰谷表（兼容涨价前旧配置）。
 * 其它模型只有三字段时按固定价计，等效峰谷倍率 1，不再套官方表。
 */

export const V4_CUTOFF_MS = 1786896000000 // 2026-08-17T00:00:00+08:00
export const WEEKEND_OFFPEAK_CUTOFF_MS = 1787414400000 // 2026-08-23T00:00:00+08:00（含）起周末全天谷价

const V4_CNY = {
  'deepseek-v4-flash': {
    listed: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
    offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  },
  'deepseek-v4-pro': {
    listed: { cacheHit: 0.025, cacheMiss: 3, output: 6 },
    peak: { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  'deepseek-v4-flash-vision-exp': {
    listed: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
    offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  },
}

const scaleUsd = (p) => ({
  cacheHit: Math.round(p.cacheHit * 0.14 * 1e6) / 1e6,
  cacheMiss: Math.round(p.cacheMiss * 0.14 * 1e6) / 1e6,
  output: Math.round(p.output * 0.14 * 1e6) / 1e6,
})

const V4_USD = Object.fromEntries(
  Object.entries(V4_CNY).map(([model, tiers]) => [model, {
    listed: scaleUsd(tiers.listed),
    peak: scaleUsd(tiers.peak),
    offPeak: scaleUsd(tiers.offPeak),
  }]),
)

const isFiniteRate = (p) => p && [p.cacheHit, p.cacheMiss, p.output].every((n) => Number.isFinite(Number(n)))

export const PINNED_V4_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']
export const PRICING_CURRENCIES = ['CNY', 'USD']

/** 官方仅提供人民币与美元价；历史 EUR 实际复用了美元数值，因此迁移为 USD。 */
export const normalizePricingCurrency = (currency) => ['USD', 'EUR'].includes(String(currency ?? '').trim().toUpperCase()) ? 'USD' : 'CNY'

export const hasTariffTiers = (p) => isFiniteRate(p?.peak) && isFiniteRate(p?.offPeak)

/**
 * 北京时间高峰时段判定（官方峰谷价规则随日期演进）：
 * - 2026-08-17 前为涨价前刊例价，本函数不参与计价；
 * - 2026-08-17 00:00 起实行峰谷定价，周一至周五 09:00–12:00、14:00–18:00 高峰，周末同规则（周末也是峰谷）；
 * - 2026-08-23 00:00（含）起，周末全天谷价（工作日不变）。
 */
export const isPeakBeijing = (timestamp) => {
  const beijing = new Date(Number(timestamp) + 8 * 3600 * 1000)
  const hour = beijing.getUTCHours()
  const dow = beijing.getUTCDay()
  const weekend = dow === 0 || dow === 6
  if (weekend && Number(timestamp) >= WEEKEND_OFFPEAK_CUTOFF_MS) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

const v4TableFor = (currency) => {
  if (currency === 'USD') return V4_USD
  if (currency === 'CNY') return V4_CNY
  return null
}

const toConfigPrice = (tiers) => ({
  cacheHit: tiers.peak.cacheHit,
  cacheMiss: tiers.peak.cacheMiss,
  output: tiers.peak.output,
  peak: { ...tiers.peak },
  offPeak: { ...tiers.offPeak },
})

/** 设置页 / Schema 默认用的 V4 官方峰谷价（不含涨价前刊例）。 */
export const officialV4ConfigPrices = (currency) => {
  const table = v4TableFor(currency)
  if (!table) return {}
  return Object.fromEntries(
    PINNED_V4_MODELS.map((model) => [model, toConfigPrice(table[model])]),
  )
}

const asRate = (p) => ({
  cacheHit: Number(p.cacheHit),
  cacheMiss: Number(p.cacheMiss),
  output: Number(p.output),
})

const parseScheduleBound = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const t = Date.parse(String(value))
  return Number.isNaN(t) ? null : t
}

/**
 * 在 schedules 时间分段中选取指定时间戳生效的分段。
 * 半开区间 [from, to)：from <= t < to；多条分段同时命中时取 from 最大者（后者覆盖）；
 * 无起点(from=null)的分段只在没有更具体分段命中时生效。
 */
const scheduleAt = (schedules, timestamp) => {
  let best = null
  for (const seg of schedules ?? []) {
    const from = parseScheduleBound(seg?.from)
    const to = parseScheduleBound(seg?.to)
    if (from !== null && timestamp < from) continue
    if (to !== null && timestamp >= to) continue
    if (best === null) { best = { from, price: seg?.price }; continue }
    if (from === null) continue
    if (best.from === null || from > best.from) best = { from, price: seg?.price }
  }
  return best?.price
}

/** 解析一个模型价格对象在指定时间戳下的实际单价：时间分段 + 日内峰谷叠加。 */
const effectiveRateAt = (price, timestamp) => {
  const seg = scheduleAt(price?.schedules, timestamp)
  const base = seg ?? price
  if (hasTariffTiers(base)) return asRate(isPeakBeijing(timestamp) ? base.peak : base.offPeak)
  return isFiniteRate(base) ? asRate(base) : null
}

/**
 * 渠道价表键候选：先精确匹配，再回退到剥离末段 `-N` 的基渠道键
 * （例如 `tokenrhythm-1` 回退到 `tokenrhythm`），避免多个同源渠道号导致渠道价漏配。
 */
const providerPriceCandidates = (provider) => {
  const keys = []
  if (provider) {
    keys.push(provider)
    const base = provider.replace(/-\d+$/, '')
    if (base !== provider) keys.push(base)
  }
  return keys
}

/**
 * 实时计算指定模型在指定时间戳、指定渠道(provider)下的单价。
 * 回退链：providerPrices[providerId][model] → prices[model]（顶级）→ defaultPrices。
 * 渠道级价格全权接管（含 schedules/峰谷），不参与内置 V4 表；顶级价格的 schedules 同样生效。
 */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now(), providerId) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const currency = normalizePricingCurrency(config.currency)
  const table = v4TableFor(currency)?.[model]

  const provider = String(providerId ?? '').trim().toLowerCase()
  if (provider) {
    const key = providerPriceCandidates(provider).find((candidate) => config.providerPrices?.[candidate]?.[model] != null)
    const providerLevel = key ? config.providerPrices[key][model] : null
    if (providerLevel != null) {
      const resolved = effectiveRateAt(providerLevel, timestamp)
      if (resolved) return resolved
    }
  }

  const configured = config.prices?.[model]
  const scheduled = configured ? scheduleAt(configured.schedules, timestamp) : null
  const effective = scheduled ?? configured
  const customTiers = hasTariffTiers(effective) ? effective : null

  if (customTiers) {
    if (!scheduled && table && timestamp < V4_CUTOFF_MS) return table.listed
    return asRate(isPeakBeijing(timestamp) ? customTiers.peak : customTiers.offPeak)
  }

  if (isFiniteRate(effective) && !(!scheduled && table && PINNED_V4_MODELS.includes(model))) {
    return asRate(effective)
  }

  if (table) {
    if (timestamp < V4_CUTOFF_MS) return table.listed
    return isPeakBeijing(timestamp) ? table.peak : table.offPeak
  }

  return effective ?? config.defaultPrices
}

export const priceBuckets = (cfg, model, buckets, timestamp = Date.now(), providerId) => {
  const price = resolveModelPrice(cfg, model, timestamp, providerId)
  return ((buckets.uncachedInputTokens + buckets.cacheWriteTokens) * price.cacheMiss +
    buckets.cacheReadTokens * price.cacheHit +
    buckets.outputTokens * price.output) / 1e6
}
