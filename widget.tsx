/* =====================================================================
 * widget.tsx（中国联通 / CUCC）
 *
 * 模块分类 · 背景
 * - 业务职责：拉数据 + 解析 + 组装成统一 CarrierData，再交给 WidgetRoot 渲染
 * - 缓存策略：数据本体落盘（documents 单文件）；Storage/BoxJS 只存 meta（updatedAt/keyFp/filename/baseDir）
 * - 隔离策略：cacheScopeKey → fingerprint 绑定；允许 allowStaleOnKeyMismatch 时可复用旧缓存
 *
 * 模块分类 · 目标
 * - 修复 TS 报错：禁止使用 <Widget>...</Widget>（Widget 不具备 JSX 构造签名）
 * - 统一注释风格：按“模块分类 · 背景/目标/使用方式/日志与边界”分区
 * - 兼容设置缺省：settings.cache 可能为 undefined，统一归一化后再使用
 *
 * 模块分类 · 使用方式
 * - 作为组件脚本运行：Widget 负责 present
 * - Cookie 来源：优先 BoxJS，其次 settings.cookie
 *
 * 模块分类 · 日志与边界
 * - 启动/配置/缓存策略与决策/网络请求/渲染完成：控制台可复盘
 * - 网络失败：允许兜底旧缓存（按 maxStaleMinutes 控制）
 * ===================================================================== */

import { Widget, Text, WidgetReloadPolicy, fetch } from "scripting"

import { WidgetRoot, CarrierData } from "./shared/carrier/widgetRoot"
import { nowHHMM, formatFlowValue } from "./shared/carrier/utils/carrierUtils"
import { pickUiSettings } from "./shared/carrier/ui"

import {
  SETTINGS_KEY,
  UNICOM_DATA_CACHE_KEY,
  UNICOM_LOGO_URL,
  UNICOM_LOGO_CACHE_KEY,
  type ChinaUnicomSettings,
  loadChinaUnicomSettings,
  resolveRefreshInterval,
  defaultChinaUnicomSettings,
} from "./settings"

import { safeGetObject, safeSetObject } from "./shared/utils/storage"
import { readJsonFromSingleFile, writeJsonToSingleFileAtomic, getCachedImagePath } from "./shared/utils/fileCache"
import { kv, errToString, srcLabel } from "./shared/utils/widgetKit"

/* =====================================================================
 * 模块分类 · 接口与资源常量
 *
 * 模块分类 · 背景
 * - 话费/基础信息：queryUserInfoSeven
 * - 套餐详情/流量：queryOcsPackageFlowLeftContentRevisedInJune
 *
 * 模块分类 · 目标
 * - 常量集中维护，避免散落
 *
 * 模块分类 · 使用方式
 * - fetchFeeData / fetchDetailData 内部使用
 *
 * 模块分类 · 日志与边界
 * - 常量区无日志
 * ===================================================================== */

const API_URL =
  "https://m.client.10010.com/mobileserviceimportant/home/queryUserInfoSeven?version=iphone_c@10.0100&desmobiel=13232135179&showType=0"

const API_DETAIL_URL =
  "https://m.client.10010.com/servicequerybusiness/operationservice/queryOcsPackageFlowLeftContentRevisedInJune"

/* =====================================================================
 * 模块分类 · 单文件缓存（Storage meta + SingleFile data）
 *
 * 模块分类 · 背景
 * - data：固定落盘（documents）
 * - meta：Storage 仅存 { updatedAt, keyFp, dataFileName, baseDir }
 *
 * 模块分类 · 目标
 * - 原子写：writeJsonToSingleFileAtomic
 * - 读容错：meta 校验 + data 读取失败即 miss
 *
 * 模块分类 · 使用方式
 * - readUnicomCache / writeUnicomCache
 *
 * 模块分类 · 日志与边界
 * - 这里不主动刷屏；上层打印策略/决策即可
 * ===================================================================== */

type UnicomBoxMeta = {
  updatedAt: number
  keyFp: string
  dataFileName: string
  baseDir: "documents" | "library" | "temporary"
}

const CU_DATA_FILE = "unicom_data.json"
const CU_DATA_BAK = "unicom_data.bak.json"

function fingerprint(raw: string): string {
  const s = String(raw ?? "")
  let hash = 5381
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash) ^ s.charCodeAt(i)
  return `djb2:${(hash >>> 0).toString(36)}`
}

function toMin(ms: number) {
  return Math.round(ms / 60000)
}

function isWithin(ms: number, now: number, ts: number): boolean {
  return now - ts <= ms
}

function safeParseFloat(val: unknown, fallback = 0): number {
  if (typeof val === "number" && !Number.isNaN(val)) return val
  const n = parseFloat(String(val ?? ""))
  return Number.isNaN(n) ? fallback : n
}

/* =====================================================================
 * 模块分类 · Cache 配置归一化
 *
 * 模块分类 · 背景
 * - settings.cache 可能为 undefined（旧版/异常合并/用户未保存）
 * - widget 渲染必须“可用默认值”，避免直接读取 undefined.xx
 *
 * 模块分类 · 目标
 * - normalizeCache(settings)：给出稳定的 cache 对象，移除不安全的 any 强转
 * - computeTtlMs：auto/fixed 的 TTL 规则与 CacheSection 对齐
 *
 * 模块分类 · 使用方式
 * - render() 中先 normalize，再读取 cache.enabled/mode/allowStale...
 *
 * 模块分类 · 日志与边界
 * - 纯计算，无日志
 * ===================================================================== */

type NormalizedCache = {
  enabled: boolean
  mode: "auto" | "cache_only" | "network_only" | "cache_disabled"
  ttlPolicy: "auto" | "fixed"
  ttlMinutesFixed: number
  allowStaleOnError: boolean
  maxStaleMinutes: number
  allowStaleOnKeyMismatch: boolean
}

function normalizeCache(settings: ChinaUnicomSettings): NormalizedCache {
  const base = defaultChinaUnicomSettings.cache ?? {}
  const raw = settings.cache ?? {}

  const enabled = raw.enabled !== false
  
  const validModes = ["auto", "cache_only", "network_only", "cache_disabled"]
  const mode = validModes.includes(raw.mode ?? "")
    ? (raw.mode as NormalizedCache["mode"])
    : (base.mode as NormalizedCache["mode"] ?? "auto")

  const validPolicies = ["fixed", "auto"]
  const ttlPolicy = validPolicies.includes(raw.ttlPolicy ?? "")
    ? (raw.ttlPolicy as NormalizedCache["ttlPolicy"])
    : (base.ttlPolicy as NormalizedCache["ttlPolicy"] ?? "auto")

  const ttlMinutesFixed =
    typeof raw.ttlMinutesFixed === "number" && Number.isFinite(raw.ttlMinutesFixed)
      ? raw.ttlMinutesFixed
      : (base.ttlMinutesFixed ?? 360)

  const allowStaleOnError = raw.allowStaleOnError !== false
  
  const maxStaleMinutes =
    typeof raw.maxStaleMinutes === "number" && Number.isFinite(raw.maxStaleMinutes)
      ? raw.maxStaleMinutes
      : (base.maxStaleMinutes ?? 1440)

  const allowStaleOnKeyMismatch = raw.allowStaleOnKeyMismatch !== false

  return {
    enabled,
    mode,
    ttlPolicy,
    ttlMinutesFixed,
    allowStaleOnError,
    maxStaleMinutes,
    allowStaleOnKeyMismatch,
  }
}

function computeTtlMs(cache: NormalizedCache, refreshIntervalMinutes: number): number {
  const refreshMs = Math.max(5, refreshIntervalMinutes || 180) * 60 * 1000
  if (cache.ttlPolicy === "fixed") return Math.max(1, cache.ttlMinutesFixed) * 60 * 1000
  return Math.max(4 * 60 * 60 * 1000, refreshMs)
}

function boundKeyFromSettings(settings: ChinaUnicomSettings): string {
  const k = String(settings.cacheScopeKey || "").trim()
  return k ? k : SETTINGS_KEY
}

function readUnicomCache(
  boundKey: string,
  allowKeyMismatch: boolean,
): { meta: UnicomBoxMeta; data: CarrierData; keyMatched: boolean } | null {
  const meta = safeGetObject<UnicomBoxMeta | null>(UNICOM_DATA_CACHE_KEY, null)
  if (!meta) return null

  if (typeof meta.updatedAt !== "number" || !Number.isFinite(meta.updatedAt)) return null
  if (typeof meta.dataFileName !== "string" || !meta.dataFileName) return null
  if (meta.baseDir !== "documents" && meta.baseDir !== "library" && meta.baseDir !== "temporary") return null
  if (typeof meta.keyFp !== "string" || !meta.keyFp) return null

  const wantFp = fingerprint(boundKey)
  const keyMatched = meta.keyFp === wantFp
  if (!keyMatched && !allowKeyMismatch) return null

  const hit = readJsonFromSingleFile<CarrierData>({
    dataFileName: meta.dataFileName,
    baseDir: meta.baseDir,
    backupFileName: CU_DATA_BAK,
  })

  if (!hit?.data) return null
  return { meta, data: hit.data, keyMatched }
}

function writeUnicomCache(boundKey: string, data: CarrierData): number {
  const ok = writeJsonToSingleFileAtomic({
    dataFileName: CU_DATA_FILE,
    backupFileName: CU_DATA_BAK,
    baseDir: "documents",
    data,
  })
  if (!ok) throw new Error("writeJsonToSingleFileAtomic failed")

  const now = Date.now()
  const meta: UnicomBoxMeta = {
    updatedAt: now,
    keyFp: fingerprint(boundKey),
    dataFileName: CU_DATA_FILE,
    baseDir: "documents",
  }
  safeSetObject(UNICOM_DATA_CACHE_KEY, meta)
  return now
}

/* =====================================================================
 * 模块分类 · 业务数据结构
 *
 * 模块分类 · 背景
 * - WidgetRoot 需要统一 CarrierData
 * - 这里定义联通侧 API 的 response 结构（宽松字段）
 *
 * 模块分类 · 目标
 * - 尽量类型化，减少 any 扩散
 *
 * 模块分类 · 使用方式
 * - fetchFeeData / fetchDetailData / extractVoiceAndFlowData
 *
 * 模块分类 · 日志与边界
 * - 类型区无日志
 * ===================================================================== */

type FeeData = { title: string; balance: string; unit: string }

type DetailApiResponse = {
  code: string
  resources?: Array<{
    type: string
    userResource: string
    remainResource: string
    details?: Array<{
      use: string
      total: string
      remain: string
      addUpItemName: string
      feePolicyName: string
      flowType?: string
      addupItemCode?: string
    }>
  }>
  canuseFlowAllUnit?: string
  canuseVoiceAllUnit?: string
  canuseSmsAllUnit?: string
  flowSumList?: Array<{
    flowtype: string
    xcanusevalue: string
    xusedvalue: string
    elemtype?: string
  }>
  fresSumList?: Array<{
    flowtype: string
    xcanusevalue: string
    xusedvalue: string
  }>
}

/* =====================================================================
 * 模块分类 · 兜底渲染（纯文本）
 *
 * 模块分类 · 背景
 * - Widget 是 API，不是 JSX 组件：不能写 <Widget>...</Widget>
 *
 * 模块分类 · 目标
 * - 任何错误/缺少 Cookie 时，保证可 present（最小 UI）
 *
 * 模块分类 · 使用方式
 * - presentMessage("xxx", reloadPolicy)
 *
 * 模块分类 · 日志与边界
 * - 不打日志；上层已输出原因
 * ===================================================================== */

function presentMessage(message: string, reloadPolicy: WidgetReloadPolicy) {
  Widget.present(<Text>{message}</Text>, reloadPolicy)
}

/* =====================================================================
 * 模块分类 · BoxJS / Cookie 读取
 *
 * 模块分类 · 背景
 * - Cookie 可从 BoxJS 同步：ComponentService -> ChinaUnicom.Settings.Cookie
 *
 * 模块分类 · 目标
 * - 读取失败不抛出：回退 settings.cookie
 *
 * 模块分类 · 使用方式
 * - fetchCookieFromBoxJs(boxJsUrl)
 *
 * 模块分类 · 日志与边界
 * - 输出读取/命中/失败原因（控制台可复盘）
 * ===================================================================== */

async function fetchCookieFromBoxJs(boxJsUrl: string): Promise<string | null> {
  const boxKey = "ComponentService"

  try {
    const base = String(boxJsUrl || "").replace(/\/$/, "")
    const url = `${base}/query/data/${boxKey}`
    console.log(`📡 Cookie | 读取 BoxJS：https://boxjs.com/query/data/ComponentService`)

    const response = await fetch(url, { headers: { Accept: "application/json" } })
    if (!response.ok) {
      console.warn(`⚠️ Cookie | BoxJS HTTP 失败：status=${response.status}`)
      return null
    }

    const data = await response.json()
    const rawVal = data?.val
    if (!rawVal) {
      console.warn("⚠️ Cookie | BoxJS 返回 val 为空")
      return null
    }

    let root: any
    try {
      root = typeof rawVal === "string" ? JSON.parse(rawVal) : rawVal
    } catch (e) {
      console.warn(`⚠️ Cookie | BoxJS val JSON 解析失败：${errToString(e)}`)
      return null
    }

    const cookie = root?.ChinaUnicom?.Settings?.Cookie
    if (cookie && typeof cookie === "string" && cookie.trim()) {
      console.log("✅ Cookie | BoxJS 命中")
      return cookie.trim()
    }

    console.warn("⚠️ Cookie | BoxJS 未找到 ChinaUnicom.Settings.Cookie")
    return null
  } catch (e) {
    console.warn(`⚠️ Cookie | BoxJS 异常：${errToString(e)}`)
    return null
  }
}

/* =====================================================================
 * 模块分类 · API 请求
 *
 * 模块分类 · 背景
 * - 话费与详情并发请求，提高整体速度
 *
 * 模块分类 · 目标
 * - 请求失败返回 null，不抛出
 *
 * 模块分类 · 使用方式
 * - Promise.all([fetchFeeData, fetchDetailData])
 *
 * 模块分类 · 日志与边界
 * - 输出关键请求与 code，便于定位问题
 * ===================================================================== */

async function fetchFeeData(cookie: string): Promise<FeeData | null> {
  try {
    console.log(`🌐 请求 | 话费：GET ${API_URL}`)
    const response = await fetch(API_URL, {
      headers: {
        Host: "m.client.10010.com",
        "User-Agent": "ChinaUnicom.x CFNetwork iOS/16.3 unicom{version:iphone_c@10.0100}",
        cookie,
      },
    })

    if (!response.ok) {
      console.warn(`⚠️ 请求 | 话费 HTTP 失败：status=${response.status}`)
      return null
    }

    const data = await response.json()
    if (data.code !== "Y") {
      console.warn(`⚠️ 请求 | 话费返回非成功：code=${data.code}`)
      return null
    }

    const { feeResource } = data
    const feeData: FeeData = {
      title: feeResource?.dynamicFeeTitle || "剩余话费",
      balance: feeResource?.feePersent || "0",
      unit: feeResource?.newUnit || "元",
    }

    console.log(`💰 话费 | ${feeData.balance}${feeData.unit}`)
    return feeData
  } catch (e) {
    console.warn(`⚠️ 请求 | 话费异常：${errToString(e)}`)
    return null
  }
}

async function fetchDetailData(cookie: string): Promise<DetailApiResponse | null> {
  try {
    console.log(`🌐 请求 | 详情：GET ${API_DETAIL_URL}`)
    const response = await fetch(API_DETAIL_URL, {
      headers: {
        Host: "m.client.10010.com",
        "User-Agent": "ChinaUnicom.x CFNetwork iOS/16.3 unicom{version:iphone_c@10.0100}",
        cookie,
      },
    })

    if (!response.ok) {
      console.warn(`⚠️ 请求 | 详情 HTTP 失败：status=${response.status}`)
      return null
    }

    const data = (await response.json()) as DetailApiResponse
    const ok = data.code === "0000" || data.code === "Y"

    console.log(
      `📦 详情 | code=${data.code}` +
        ` | flowSumList=${data.flowSumList?.length ?? 0}` +
        ` | fresSumList=${data.fresSumList?.length ?? 0}` +
        ` | resources=${data.resources?.length ?? 0}` +
        ` | ok=${ok ? "Y" : "N"}`,
    )

    if (!ok) return null
    return data
  } catch (e) {
    console.warn(`⚠️ 请求 | 详情异常：${errToString(e)}`)
    return null
  }
}

/* =====================================================================
 * 模块分类 · 解析语音与通用流量
 *
 * 模块分类 · 背景
 * - Voice：resources.type=Voice
 * - 通用流量：优先 flowSumList(flowtype=1)，否则回退 resources.Flow
 *
 * 模块分类 · 目标
 * - 输出统一结构：{ voice, flow }，通过 safeParseFloat 强化对 NaN 的防范
 *
 * 模块分类 · 使用方式
 * - extractVoiceAndFlowData(detailData)
 *
 * 模块分类 · 日志与边界
 * - 解析失败返回 null
 * ===================================================================== */

function extractVoiceAndFlowData(detailData: DetailApiResponse): {
  voice: { title: string; balance: string; unit: string; used?: number; total?: number }
  flow: { title: string; balance: string; unit: string; used?: number; total?: number }
} | null {
  try {
    const voiceResource = detailData.resources?.find((r) => r.type === "Voice")
    const voiceRemain = voiceResource?.remainResource || "0"
    const voiceUsed = voiceResource?.userResource || "0"
    const voiceTotal = safeParseFloat(voiceRemain) + safeParseFloat(voiceUsed)
    const voiceUnit = "分钟"

    const generalFlow = detailData.flowSumList?.find((item) => item.flowtype === "1")
    let flowRemainMB = 0
    let flowUsedMB = 0

    if (generalFlow?.xcanusevalue) {
      flowRemainMB = safeParseFloat(generalFlow.xcanusevalue)
      flowUsedMB = safeParseFloat(generalFlow.xusedvalue)
      console.log(`📶 通用流量 | flowSumList(flowtype=1) | remainMB=${flowRemainMB} usedMB=${flowUsedMB}`)
    } else {
      const flowResource = detailData.resources?.find((r) => String(r.type).toLowerCase() === "flow")
      const remainStr = flowResource?.remainResource || "0"
      const usedStr = flowResource?.userResource || "0"
      const unit = detailData.canuseFlowAllUnit || "GB"

      if (unit === "MB") {
        flowRemainMB = safeParseFloat(remainStr)
        flowUsedMB = safeParseFloat(usedStr)
      } else {
        flowRemainMB = safeParseFloat(remainStr) * 1024
        flowUsedMB = safeParseFloat(usedStr) * 1024
      }

      console.log(
        `📶 通用流量 | resources.Flow(fallback) | remainMB=${flowRemainMB} usedMB=${flowUsedMB} (unit=${unit})`,
      )
    }

    const flowFormatted = formatFlowValue(flowRemainMB, "MB")
    const flowTotalMB = flowRemainMB + flowUsedMB

    return {
      voice: {
        title: "剩余语音",
        balance: voiceRemain,
        unit: voiceUnit,
        used: safeParseFloat(voiceUsed),
        total: voiceTotal,
      },
      flow: {
        title: "通用流量",
        balance: flowFormatted.balance,
        unit: flowFormatted.unit,
        used: flowUsedMB,
        total: flowTotalMB,
      },
    }
  } catch (e) {
    console.warn(`⚠️ 解析 | 提取语音/通用流量异常：${errToString(e)}`)
    return null
  }
}

/* =====================================================================
 * 模块分类 · 主渲染入口
 *
 * 模块分类 · 背景
 * - 优先缓存：命中新鲜缓存直接渲染
 * - 需要 network：并发请求 → 解析 → 渲染 → 成功才写缓存
 *
 * 模块分类 · 目标
 * - 缓存模式：auto/cache_only/network_only/cache_disabled 与 CacheSection 对齐
 * - 兜底策略：网络失败且 within maxStale 时回退旧缓存
 *
 * 模块分类 · 使用方式
 * - render() 脚本末尾直接执行
 *
 * 模块分类 · 日志与边界
 * - 每次 run 都输出关键策略/决策；异常不抛出到宿主
 * ===================================================================== */

async function render() {
  const t0 = Date.now()

  const settings = loadChinaUnicomSettings()
  const cache = normalizeCache(settings)
  const ui = pickUiSettings(settings)

  const refreshInterval = resolveRefreshInterval(settings.refreshInterval, 180)
  const nextUpdate = new Date(Date.now() + refreshInterval * 60 * 1000)
  const reloadPolicy: WidgetReloadPolicy = { policy: "after", date: nextUpdate }

  const forceRefresh = cache.mode === "network_only"

  const matchType = (settings.otherFlowMatchType ?? "flowType") as "flowType" | "addupItemCode"
  const matchValueRaw = String(settings.otherFlowMatchValue ?? "")
  const matchValue = matchValueRaw.trim() ? matchValueRaw.trim() : "2"

  const enableBoxJs = !!settings.enableBoxJs
  const boxJsUrl = String(settings.boxJsUrl ?? "").trim()

  console.log(`🚀 组件启动 | carrier=CUCC | refresh=${refreshInterval}m`)
  console.log(
    `⚙️ 配置读取 | ${kv({
      matchType,
      matchValue,
      enableBoxJs: enableBoxJs ? "Y" : "N",
      boxJsUrl: boxJsUrl ? "Y" : "N",
      cacheEnabled: cache.enabled ? "Y" : "N",
      cacheMode: cache.mode,
      ttlPolicy: cache.ttlPolicy,
      ttlFixed: cache.ttlMinutesFixed,
      allowStale: cache.allowStaleOnError ? "Y" : "N",
      maxStale: cache.maxStaleMinutes,
      allowKeyMismatch: cache.allowStaleOnKeyMismatch ? "Y" : "N",
      force: forceRefresh ? "Y" : "N",
    })}`,
  )

  let cookie = String(settings.cookie || "").trim()
  if (enableBoxJs && boxJsUrl) {
    const box = await fetchCookieFromBoxJs(boxJsUrl)
    if (box) {
      cookie = box
      console.log("✅ Cookie | source=BoxJS")
    } else {
      console.warn("⚠️ Cookie | BoxJS 失败，回退 settings.cookie")
      console.log(`✅ Cookie | source=${cookie ? "Settings" : "None"}`)
    }
  } else {
    console.log(`✅ Cookie | source=${cookie ? "Settings" : "None"}`)
  }

  if (!cookie) {
    presentMessage("请先在主应用中设置联通 Cookie，或配置 BoxJs 地址。", reloadPolicy)
    return
  }

  /* =====================================================================
   * 模块分类 · 缓存读取与决策
   *
   * 模块分类 · 背景
   * - 依据配置的 Cache 规则，在内存中动态推演数据源取向（本地新鲜、网络强制、旧数据隔离等）
   *
   * 模块分类 · 目标
   * - 决定是采取命中缓存（hit）返回，还是直通网络（need_network）
   *
   * 模块分类 · 使用方式
   * - 配合 readUnicomCache 及 computeTtlMs 内部串行消费
   *
   * 模块分类 · 日志与边界
   * - 输出详尽的单行推演信息，包括 TTL、当前陈旧度及 keyMatched 标志
   * ===================================================================== */

  const ttlMs = computeTtlMs(cache, refreshInterval)
  const boundKey = boundKeyFromSettings(settings)
  const boundKeyShort = fingerprint(boundKey).slice(0, 12)

  const hit = cache.enabled && cache.mode !== "cache_disabled" ? readUnicomCache(boundKey, cache.allowStaleOnKeyMismatch) : null
  const meta = hit?.meta ?? null
  const cached = hit?.data ?? null

  const cacheAgeMin = meta?.updatedAt ? toMin(Date.now() - meta.updatedAt) : undefined
  const keyMatched = hit ? hit.keyMatched : undefined
  const fresh = !!meta?.updatedAt && isWithin(ttlMs, Date.now(), meta.updatedAt)

  console.log(
    `🧠 缓存策略：` +
      `启用=${cache.enabled ? "Y" : "N"}` +
      `｜模式=${cache.mode}` +
      `｜TTL=${toMin(ttlMs)}分钟` +
      `｜兜底=${cache.allowStaleOnError ? "允许" : "禁止"}` +
      `｜最大陈旧=${Math.max(1, cache.maxStaleMinutes)}分钟` +
      `｜刷新=${refreshInterval}分钟` +
      `｜强制刷新=${forceRefresh ? "是" : "否"}` +
      `｜当前缓存=${cacheAgeMin == null ? "-" : `${cacheAgeMin}分钟`}` +
      `｜keyMatched=${keyMatched === undefined ? "-" : keyMatched ? "Y" : "N"}` +
      `｜boundKey=${boundKeyShort}`,
  )

  let cachedData: CarrierData | null = null
  let decision = "none"

  if (!cache.enabled || cache.mode === "cache_disabled") {
    decision = "cache_disabled(read_off)"
  } else if (cache.mode === "cache_only") {
    if (cached) {
      cachedData = cached
      decision = keyMatched ? "cache_only -> hit" : "cache_only -> hit(key_mismatch_reuse)"
    } else {
      decision = "cache_only -> miss"
    }
  } else if (cache.mode !== "network_only") {
    if (cached && fresh && !forceRefresh) {
      cachedData = cached
      decision = keyMatched ? "auto -> cache_fresh" : "auto -> cache_fresh(key_mismatch_reuse)"
    } else {
      decision = forceRefresh ? "auto -> force_refresh" : "auto -> need_network"
    }
  } else {
    decision = "network_only -> need_network"
  }

  if (cachedData) {
    console.log(`🧠 缓存决策：${decision} | age=${cacheAgeMin ?? "-"}min`)

    const tag = fresh ? "缓存" : "缓存(旧)"
    const dataForRender: CarrierData = { ...cachedData, updateTime: `${nowHHMM()}·${tag}` }

    const logoPath = await getCachedImagePath({
      url: UNICOM_LOGO_URL,
      cacheKey: UNICOM_LOGO_CACHE_KEY,
      filePrefix: "unicom_logo",
      fileExt: "png",
      baseDir: "documents",
    })

    console.log(logoPath ? `🖼️ Logo：local_ok · path=${logoPath}` : `🖼️ Logo：miss/timeout · continue_render`)

    console.log(
      `✅ 渲染完成 | run=${nowHHMM()} | src=${srcLabel("local", true)} | cost=${Date.now() - t0}ms | decision=${decision}`,
    )
    Widget.present(<WidgetRoot data={dataForRender} ui={ui} logoPath={logoPath} />, reloadPolicy)
    return
  }

  if (cache.enabled && cache.mode === "cache_only") {
    console.warn("⚠️ 缓存决策：cache_only -> miss（无可用缓存）")
    presentMessage("⚠️ 无可用缓存（cache_only）", reloadPolicy)
    return
  }

  /* =====================================================================
   * 模块分类 · 网络请求与并发
   *
   * 模块分类 · 背景
   * - 当缓存失效或被强刷时，通过并发发起话费和详情数据的 HTTP 请求以提高加载效率
   *
   * 模块分类 · 目标
   * - 联通服务端如果发生熔断或不可用，保障能够捕获异常并激活陈旧缓存兜底渲染
   *
   * 模块分类 · 使用方式
   * - 借助 Promise.all 异步拉取并分配至 feeData 及 detailData
   *
   * 模块分类 · 日志与边界
   * - 当完全没有数据可用且没有多余旧缓存时，最终调用 presentMessage 渲染通用文字报错
   * ===================================================================== */

  const [feeData, detailData] = await Promise.all([fetchFeeData(cookie), fetchDetailData(cookie)])

  if (!feeData || !detailData) {
    console.warn(`⚠️ 网络失败 | fee=${feeData ? "Y" : "N"} detail=${detailData ? "Y" : "N"}`)

    if (cache.enabled && cache.allowStaleOnError && cached && meta?.updatedAt) {
      const maxStaleMs = Math.max(1, cache.maxStaleMinutes) * 60 * 1000
      const within = isWithin(maxStaleMs, Date.now(), meta.updatedAt)

      console.warn(
        `🧠 缓存决策：网络失败 → ${within ? "启用兜底缓存" : "兜底失败(过期)"} | ` +
          `age=${cacheAgeMin ?? "-"}min | maxStale=${toMin(maxStaleMs)}min`,
      )

      if (within) {
        const logoPath = await getCachedImagePath({
          url: UNICOM_LOGO_URL,
          cacheKey: UNICOM_LOGO_CACHE_KEY,
          filePrefix: "unicom_logo",
          fileExt: "png",
          baseDir: "documents",
        })

        const dataForRender: CarrierData = { ...cached, updateTime: `${nowHHMM()}·兜底缓存` }

        console.log(logoPath ? `🖼️ Logo：local_ok · path=${logoPath}` : `🖼️ Logo：miss/timeout · continue_render`)

        console.log(
          `✅ 渲染完成 | run=${nowHHMM()} | src=${srcLabel("local", true)} | cost=${Date.now() - t0}ms | decision=stale_fallback`,
        )
        Widget.present(<WidgetRoot data={dataForRender} ui={ui} logoPath={logoPath} />, reloadPolicy)
        return
      }
    }

    presentMessage("获取数据失败，请检查网络或 Cookie。", reloadPolicy)
    return
  }

  const voiceAndFlowData = extractVoiceAndFlowData(detailData)
  if (!voiceAndFlowData) {
    presentMessage("提取数据失败。", reloadPolicy)
    return
  }

  /* =====================================================================
   * 模块分类 · 定向/专属流量提取
   *
   * 模块分类 · 背景
   * - 用户可以根据需要匹配特定的专属/副卡流量，配置方式支持 flowType 与 addupItemCode 两种路由
   *
   * 模块分类 · 目标
   * - 从复杂的 details 数组中多阶级递进检索匹配，并转换为标准的 流量数据模型
   *
   * 模块分类 · 使用方式
   * - 内部顺序分析 detailData.flowSumList 与 detailData.fresSumList，将结果映射至 otherFlowData
   *
   * 模块分类 · 日志与边界
   * - 过滤并排查 NaN，匹配失败时自动降级控制台输出 not_found，不干扰主数据上屏
   * ===================================================================== */

  let otherFlowData:
    | { title: string; balance: string; unit: string; used?: number; total?: number }
    | undefined

  console.log(`🔍 定向流量 | matchType=${matchType} matchValue=${matchValue}`)

  const flowRes = detailData.resources?.find((r) => String(r.type).toLowerCase() === "flow")
  let totalRemainMB = 0
  let totalUsedMB = 0

  if (matchType === "flowType") {
    const item = detailData.flowSumList?.find((it) => String(it.flowtype) === String(matchValue))
    console.log(`🔎 定向流量 | flowSumList(flowtype=${matchValue}) hit=${item ? "Y" : "N"}`)
    if (item) {
      totalRemainMB = safeParseFloat(item.xcanusevalue)
      totalUsedMB = safeParseFloat(item.xusedvalue)
    }
  }

  if (totalRemainMB === 0 && totalUsedMB === 0 && matchType === "flowType") {
    const item = detailData.fresSumList?.find((it) => String(it.flowtype) === String(matchValue))
    console.log(`🔎 定向流量 | fresSumList(flowtype=${matchValue}) hit=${item ? "Y" : "N"}`)
    if (item) {
      totalRemainMB = safeParseFloat(item.xcanusevalue)
      totalUsedMB = safeParseFloat(item.xusedvalue)
    }
  }

  if (totalRemainMB === 0 && totalUsedMB === 0 && flowRes?.details?.length) {
    console.log("🔎 定向流量 | resources.Flow.details 精确匹配")
    for (const detail of flowRes.details) {
      const isMatch =
        matchType === "flowType"
          ? String(detail.flowType) === String(matchValue)
          : String(detail.addupItemCode) === String(matchValue)
      if (!isMatch) continue

      const remain = safeParseFloat(detail.remain)
      const used = safeParseFloat(detail.use)
      totalRemainMB += remain
      totalUsedMB += used
    }
  }

  if (totalRemainMB === 0 && totalUsedMB === 0 && flowRes?.details?.length) {
    console.warn("⚠️ 定向流量 | 未命中匹配项，兜底汇总 flowType!=1")
    for (const detail of flowRes.details) {
      const ft = String(detail.flowType ?? "")
      if (ft === "1") continue

      const remain = safeParseFloat(detail.remain)
      const used = safeParseFloat(detail.use)
      totalRemainMB += remain
      totalUsedMB += used
    }
  }

  if (totalRemainMB > 0 || totalUsedMB > 0) {
    const remainFormatted = formatFlowValue(totalRemainMB, "MB")
    otherFlowData = {
      title: "定向流量",
      balance: remainFormatted.balance,
      unit: remainFormatted.unit,
      used: totalUsedMB,
      total: totalRemainMB + totalUsedMB,
    }
    console.log(`📶 定向流量 | remain=${otherFlowData.balance}${otherFlowData.unit}`)
  } else {
    console.log("📶 定向流量 | not_found")
  }

  const mergedData: CarrierData = {
    fee: feeData,
    voice: voiceAndFlowData.voice,
    flow: voiceAndFlowData.flow,
    otherFlow: otherFlowData,
    updateTime: nowHHMM(),
  }

  /* =====================================================================
   * 模块分类 · 写缓存（成功才写）
   *
   * 模块分类 · 背景
   * - 网络请求完全成功且业务字段解析无缺损后，执行原子落盘，防止数据污染
   *
   * 模块分类 · 目标
   * - 将最新的 CarrierData 写入单文件，并同步时间戳与指纹至持久化 Meta 区域
   *
   * 模块分类 · 使用方式
   * - 依赖 writeUnicomCache 原子化写入
   *
   * 模块分类 · 日志与边界
   * - 独立捕获文件系统异常，并向控制台抛出警告信息，但不破坏最后的渲染过程
   * ===================================================================== */

  try {
    const cacheUpdatedAt = writeUnicomCache(boundKey, mergedData)
    console.log(`💾 写缓存成功 | updatedAt=${cacheUpdatedAt} | boundKey=${fingerprint(boundKey).slice(0, 12)}`)
  } catch (e) {
    console.warn(`⚠️ 写缓存异常 | ${errToString(e)}`)
  }

  const logoPath = await getCachedImagePath({
    url: UNICOM_LOGO_URL,
    cacheKey: UNICOM_LOGO_CACHE_KEY,
    filePrefix: "unicom_logo",
    fileExt: "png",
    baseDir: "documents",
  })

  console.log(logoPath ? `🖼️ Logo：local_ok · path=${logoPath}` : `🖼️ Logo：miss/timeout · continue_render`)

  console.log(
    `✅ 渲染完成 | run=${nowHHMM()} | src=${srcLabel("network", false)} | cost=${Date.now() - t0}ms | decision=network_ok`,
  )
  Widget.present(<WidgetRoot data={mergedData} ui={ui} logoPath={logoPath} />, reloadPolicy)
}

render()
