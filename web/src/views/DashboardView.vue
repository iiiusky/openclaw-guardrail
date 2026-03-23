<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h } from 'vue'
import {
  NCard,
  NDataTable,
  NResult,
  NTag,
  NEllipsis,
  NText,
  NSkeleton,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import {
  getStats,
  getViolations,
  getTrendStats,
  getDevices,
  getAssetReports,
  getCapabilityStats,
} from '../api'
import type {
  StatsResponse,
  ViolationRecord,
  TrendStatsResponse,
  DeviceRecord,
  AssetReport,
} from '../api'

use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent])

// ── State ─────────────────────────────────────────────────
const loading = ref(true)
const error = ref('')
const stats = ref<StatsResponse | null>(null)
const violations = ref<ViolationRecord[]>([])
const trend = ref<TrendStatsResponse | null>(null)
const devices = ref<DeviceRecord[]>([])
const _assets = ref<AssetReport[]>([])

let refreshTimer: ReturnType<typeof setInterval> | null = null

// ── Detection Capabilities ────────────────────────────────
interface DetectionCapability {
  name: string
  key: string
  description: string
}

const detectionCapabilities: DetectionCapability[] = [
  { name: '域名黑名单', key: 'domain_block', description: '阻断外发敏感域名' },
  { name: '敏感数据检测', key: 'sensitive_data', description: 'DLP 关键字匹配' },
  { name: '高危命令拦截', key: 'dangerous_cmd', description: '阻断 rm -rf 等破坏性命令' },
  { name: 'Skill 供应链审计', key: 'skill_audit', description: '安装前安全扫描' },
  { name: 'LLM 请求拦截', key: 'llm_intercept', description: 'fetch 劫持 + SSE 响应构造' },
  { name: '配置文件保护', key: 'config_protect', description: '禁止读写 openclaw.json' },
]

// ── Topology SVG Coordinates ──────────────────────────────
const LEFT_COL_X = 16
const LEFT_COL_W = 190
const CENTER_X = 460
const CENTER_Y = 220
const RIGHT_COL_X = 720
const RIGHT_COL_W = 340
const NODE_H = 44
const NODE_GAP = 10

interface SvgNode {
  x: number
  y: number
  w: number
  h: number
  key?: string
  label: string
  active: boolean
  count?: number
  risk?: number
  name?: string
  desc?: string
  rightEdgeX: number
  rightEdgeY: number
  leftEdgeX: number
  leftEdgeY: number
}

interface SvgPath {
  d: string
  active: boolean
}

// ── Helpers ───────────────────────────────────────────────
function isOnline(lastSeen: string): boolean {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < 15 * 60 * 1000
}

function truncateId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : id
}

function formatTime(ts: string): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function trendPercent(today: number, yesterday: number): { text: string; positive: boolean } {
  if (yesterday === 0 && today === 0) return { text: '--', positive: false }
  if (yesterday === 0) return { text: `+${today}`, positive: false }
  const pct = Math.round(((today - yesterday) / yesterday) * 100)
  if (pct > 0) return { text: `+${pct}%`, positive: false }
  if (pct < 0) return { text: `${pct}%`, positive: true }
  return { text: '0%', positive: false }
}

// ── Computed ──────────────────────────────────────────────
interface UserGroup {
  user_name: string
  devices: DeviceRecord[]
  hasOnlineDevice: boolean
}

const userGroups = computed((): UserGroup[] => {
  const map = new Map<string, DeviceRecord[]>()
  for (const d of devices.value) {
    const name = d.user_name || '未知用户'
    if (!map.has(name)) map.set(name, [])
    map.get(name)!.push(d)
  }
  return Array.from(map.entries())
    .map(([user_name, devs]) => ({
      user_name,
      devices: devs.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()),
      hasOnlineDevice: devs.some(d => isOnline(d.last_seen)),
    }))
    .sort((a, b) => {
      if (a.hasOnlineDevice !== b.hasOnlineDevice) return a.hasOnlineDevice ? -1 : 1
      return b.devices.length - a.devices.length
    })
})

const displayUsers = computed(() => userGroups.value.slice(0, 8))
const extraUserCount = computed(() => Math.max(0, userGroups.value.length - 8))

const leftNodes = computed((): SvgNode[] => {
  const users = displayUsers.value
  const totalH = users.length > 0
    ? users.length * NODE_H + (users.length - 1) * NODE_GAP
    : NODE_H
  const startY = CENTER_Y - totalH / 2

  return users.map((u, i) => {
    const y = startY + i * (NODE_H + NODE_GAP)
    return {
      x: LEFT_COL_X,
      y,
      w: LEFT_COL_W,
      h: NODE_H,
      label: u.user_name.length > 8 ? `${u.user_name.slice(0, 8)}..` : u.user_name,
      active: u.hasOnlineDevice,
      count: u.devices.length,
      rightEdgeX: LEFT_COL_X + LEFT_COL_W,
      rightEdgeY: y + NODE_H / 2,
      leftEdgeX: LEFT_COL_X,
      leftEdgeY: y + NODE_H / 2,
    }
  })
})

const capStatsData = ref<Record<string, { total: number; blocked: number }>>({})

const capabilityStats = computed(() => {
  const caps = capStatsData.value
  return new Map<string, { count: number; risk: number }>(
    Object.entries(caps).map(([key, val]) => [key, { count: val.total, risk: val.blocked }])
  )
})

const rightNodes = computed((): SvgNode[] => {
  const caps = detectionCapabilities
  const rightNodeH = NODE_H + 8
  const totalH = caps.length * rightNodeH + (caps.length - 1) * NODE_GAP
  const startY = CENTER_Y - totalH / 2

  return caps.map((cap, i) => {
    const y = startY + i * (rightNodeH + NODE_GAP)
    const capStat = capabilityStats.value.get(cap.key)
    return {
      x: RIGHT_COL_X,
      y,
      w: RIGHT_COL_W,
      h: rightNodeH,
      key: cap.key,
      label: cap.name,
      name: cap.name,
      desc: cap.description,
      count: capStat?.count || 0,
      risk: capStat?.risk || 0,
      active: true,
      leftEdgeX: RIGHT_COL_X,
      leftEdgeY: y + rightNodeH / 2,
      rightEdgeX: RIGHT_COL_X + RIGHT_COL_W,
      rightEdgeY: y + rightNodeH / 2,
    }
  })
})

const leftPaths = computed((): SvgPath[] => {
  const coreLeftX = CENTER_X - 86
  return leftNodes.value.map(node => ({
    d: `M ${node.rightEdgeX},${node.rightEdgeY} C ${node.rightEdgeX + 95},${node.rightEdgeY} ${coreLeftX - 95},${CENTER_Y} ${coreLeftX},${CENTER_Y}`,
    active: node.active,
  }))
})

const rightPaths = computed((): SvgPath[] => {
  const coreRightX = CENTER_X + 86
  return rightNodes.value.map(node => ({
    d: `M ${coreRightX},${CENTER_Y} C ${coreRightX + 110},${CENTER_Y} ${node.leftEdgeX - 95},${node.leftEdgeY} ${node.leftEdgeX},${node.leftEdgeY}`,
    active: true,
  }))
})

function getUserTooltip(label: string): string {
  const prefix = label.replace(/\.\.$/, '')
  const user = displayUsers.value.find(u => u.user_name.startsWith(prefix))
  if (!user) return label

  const devList = user.devices
    .map((d) => {
      const status = isOnline(d.last_seen) ? '[在线]' : '[离线]'
      return `  ${status} ${d.hostname || truncateId(d.device_id)}`
    })
    .join('\n')

  return `${user.user_name} (${user.devices.length} 台设备)\n${devList}`
}

const onlineCount = computed(() => devices.value.filter(d => isOnline(d.last_seen)).length)
const totalProtection = computed(() => {
  return onlineCount.value * detectionCapabilities.length
})

const statCards = computed(() => {
  if (!trend.value) return []
  const t = trend.value.today
  const vTrend = trendPercent(t.violations, t.yesterday_violations)
  const totalBlocked = trend.value.violation_trend.reduce((s, d) => s + (d.blocked || 0), 0)

  return [
    {
      label: '已激活设备',
      value: devices.value.length,
      trend: null,
      accent: '#63e2b7',
      sub: `${onlineCount.value} 在线`,
    },
    {
      label: '今日违规',
      value: t.violations,
      trend: vTrend,
      accent: '#e88080',
      sub: null,
    },
    {
      label: '已拦截',
      value: totalBlocked,
      trend: null,
      accent: '#f0a020',
      sub: '近14天累计',
    },
    {
      label: '扫描报告',
      value: t.reports,
      trend: null,
      accent: '#63a4ff',
      sub: null,
    },
  ]
})

const violationChartOption = computed(() => {
  if (!trend.value) return {}
  const data = trend.value.violation_trend
  const dates = data.map(d => d.date)
  const blocked = data.map(d => d.blocked || 0)
  const detected = data.map(d => d.detected || 0)

  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#ffffffd1' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(24, 24, 28, 0.95)',
      borderColor: '#ffffff1a',
      textStyle: { color: '#ffffffd1', fontSize: 12 },
    },
    legend: {
      data: ['已拦截', '已检测'],
      textStyle: { color: '#ffffff8a' },
      top: 4,
      right: 16,
    },
    grid: { left: 48, right: 20, top: 40, bottom: 28 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: '#ffffff4d' } },
      axisLabel: {
        color: '#ffffff8a',
        fontSize: 11,
        formatter: (v: string) => {
          const parts = v.split('-')
          return `${parts[1]}/${parts[2]}`
        },
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisLabel: { color: '#ffffff8a', fontSize: 11 },
      splitLine: { lineStyle: { color: '#ffffff1a' } },
    },
    series: [
      {
        name: '已拦截',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: blocked,
        lineStyle: { color: '#e88080', width: 2.5 },
        itemStyle: { color: '#e88080' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(232, 128, 128, 0.35)' },
              { offset: 1, color: 'rgba(232, 128, 128, 0.02)' },
            ],
          },
        },
      },
      {
        name: '已检测',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: detected,
        lineStyle: { color: '#63a4ff', width: 2.5 },
        itemStyle: { color: '#63a4ff' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(99, 164, 255, 0.30)' },
              { offset: 1, color: 'rgba(99, 164, 255, 0.02)' },
            ],
          },
        },
      },
    ],
  }
})

const rankColors = ['#e88080', '#f0a020', '#63a4ff']

const hookSourceLabels: Record<string, string> = {
  llm_input: 'LLM 输入',
  llm_output: 'LLM 输出',
  before_tool_call: '工具调用前',
  after_tool_call: '工具调用后',
  fetch_interceptor: 'Fetch 拦截',
  skill_install: 'Skill 安装',
}

const violationColumns: DataTableColumns<ViolationRecord> = [
  { title: '时间', key: 'received_at', width: 170, sorter: 'default', render: (row) => formatTime(row.received_at) },
  { title: '用户', key: 'user_name', width: 90, render: (row) => row.user_name || '-' },
  { title: '设备', key: 'device_id', width: 110, render: (row) => truncateId(row.device_id) },
  {
    title: '触发点',
    key: 'hook_source',
    width: 110,
    render: (row) =>
      h(NTag, { size: 'small', bordered: false }, { default: () => hookSourceLabels[row.hook_source] || row.hook_source || row.tool_name || '-' }),
  },
  {
    title: '工具',
    key: 'tool_name',
    width: 120,
    ellipsis: { tooltip: true },
    render: (row) => {
      if (!row.tool_name || ['llm_input', 'llm_output', 'llm_request', 'llm_response'].includes(row.tool_name)) return '-'
      return row.tool_name
    },
  },
  {
    title: '匹配',
    key: 'matched',
    width: 140,
    render: (row) => row.matched_domain || row.matched_keyword || '-',
  },
  {
    title: '动作',
    key: 'action',
    width: 80,
    render: (row) =>
      h(NTag, { size: 'small', type: row.action === 'blocked' ? 'error' : 'warning', bordered: false }, { default: () => row.action }),
  },
  {
    title: '上下文',
    key: 'context',
    ellipsis: { tooltip: true },
    render: (row) => h(NEllipsis, { style: 'max-width: 260px' }, { default: () => row.context || row.matched_domain || row.matched_keyword }),
  },
]

// ── Data Fetch ────────────────────────────────────────────
async function fetchData() {
  try {
    const [statsData, violationsData, trendData, devicesData, assetsData, capData] = await Promise.all([
      getStats(),
      getViolations({ limit: 10 }),
      getTrendStats(14),
      getDevices(),
      getAssetReports(),
      getCapabilityStats(14),
    ])
    stats.value = statsData
    violations.value = violationsData.violations || statsData.recent_violations || []
    trend.value = trendData
    devices.value = devicesData.devices || []
    _assets.value = assetsData.assets || []
    capStatsData.value = capData.capabilities || {}
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// ── Lifecycle ─────────────────────────────────────────────
onMounted(() => {
  fetchData()
  refreshTimer = setInterval(fetchData, 60_000)
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})
</script>

<template>
  <div class="dashboard">
    <NResult v-if="error" status="error" :title="error" description="请检查 API 配置和网络连接" />
    <template v-else>

      <!-- Section 1: Hero Stats Row -->
      <div class="stat-row">
        <div
          v-for="card in statCards"
          :key="card.label"
          class="stat-card"
          :style="{ '--accent': card.accent }"
        >
          <template v-if="loading">
            <NSkeleton width="60%" :height="28" :sharp="false" style="margin-bottom: 8px" />
            <NSkeleton width="40%" :height="16" :sharp="false" />
          </template>
          <template v-else>
            <div class="stat-card__value">{{ card.value }}</div>
            <div class="stat-card__label">{{ card.label }}</div>
            <div
              v-if="card.trend"
              class="stat-card__trend"
              :class="card.trend.positive ? 'trend--good' : 'trend--bad'"
            >
              {{ card.trend.text }}
              <span class="trend__sub">vs 昨日</span>
            </div>
            <div v-else-if="card.sub" class="stat-card__sub">{{ card.sub }}</div>
          </template>
        </div>
      </div>

      <!-- Section 2: Compact Security Topology -->
      <div class="topo-section">
        <template v-if="loading">
          <NSkeleton width="100%" :height="360" :sharp="false" />
        </template>
        <template v-else>
          <svg class="topology-svg" viewBox="0 0 1100 460" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="line-active" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#63e2b7" stop-opacity="0.8" />
                <stop offset="50%" stop-color="#00C2A8" stop-opacity="0.9" />
                <stop offset="100%" stop-color="#4A90E2" stop-opacity="0.8" />
              </linearGradient>
              <linearGradient id="shield-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#00C2A8" />
                <stop offset="100%" stop-color="#4A90E2" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="icon-glow">
                <feGaussianBlur stdDeviation="2.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <!-- Connections: Left → Center -->
            <path
              v-for="(conn, i) in leftPaths"
              :key="`lc-${i}`"
              :d="conn.d"
              fill="none"
              :stroke="conn.active ? 'url(#line-active)' : 'rgba(255,255,255,0.05)'"
              :stroke-width="conn.active ? 4 : 2"
              stroke-linecap="round"
              :filter="conn.active ? 'url(#glow)' : undefined"
            />

            <!-- Connections: Center → Right -->
            <path
              v-for="(conn, i) in rightPaths"
              :key="`cr-${i}`"
              :d="conn.d"
              fill="none"
              stroke="url(#line-active)"
              stroke-width="4"
              stroke-linecap="round"
              filter="url(#glow)"
            />

            <!-- Left: User nodes with icon-box + state -->
            <g v-for="(node, i) in leftNodes" :key="`ln-${i}`" class="topo-node-group">
              <title>{{ getUserTooltip(node.label) }}</title>
              <rect
                class="topo-card"
                :x="node.x"
                :y="node.y"
                :width="node.w"
                :height="node.h"
                rx="10"
                :fill="node.active ? 'rgba(99,226,183,0.04)' : 'rgba(255,255,255,0.04)'"
                :stroke="node.active ? 'rgba(99,226,183,0.3)' : 'rgba(255,255,255,0.08)'"
                stroke-width="1"
              />

              <rect
                class="topo-icon-box"
                :x="node.x + 6"
                :y="node.y + 4"
                width="36"
                height="36"
                rx="10"
                fill="rgba(255,255,255,0.04)"
                :stroke="node.active ? 'rgba(99,226,183,0.4)' : 'rgba(255,255,255,0.1)'"
                stroke-width="0.8"
                :filter="node.active ? 'url(#icon-glow)' : undefined"
              />
              <g
                :transform="`translate(${node.x + 10}, ${node.y + 8}) scale(1.1)`"
                fill="none"
                :stroke="node.active ? '#63e2b7' : '#ffffff8a'"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="9" r="4" />
                <path d="M4 21c0-3.5 3.6-6.5 8-6.5s8 3 8 6.5" />
              </g>

              <text
                :x="node.x + 50"
                :y="node.y + 19"
                fill="#ffffffd9"
                font-size="12.5"
                font-weight="600"
              >
                {{ node.label }}
              </text>
              <text
                :x="node.x + 50"
                :y="node.y + 33"
                fill="#ffffff8a"
                font-size="10"
                font-weight="500"
              >
                {{ node.count }} 台设备
              </text>

              <rect
                :x="node.x + node.w - 50"
                :y="node.y + 8"
                width="40"
                height="16"
                rx="8"
                :fill="node.active ? 'rgba(99,226,183,0.12)' : 'rgba(255,255,255,0.06)'"
              />
              <text
                :x="node.x + node.w - 30"
                :y="node.y + 19.5"
                text-anchor="middle"
                :fill="node.active ? '#63e2b7' : '#ffffff4d'"
                font-size="10"
                font-weight="700"
              >
                {{ node.active ? '在线' : '离线' }}
              </text>

              <rect
                :x="node.x + node.w - 34"
                :y="node.y + 25"
                width="24"
                height="14"
                rx="6"
                fill="rgba(255,255,255,0.08)"
              />
              <text
                :x="node.x + node.w - 22"
                :y="node.y + 35.5"
                text-anchor="middle"
                fill="#ffffffd9"
                font-size="9"
                font-weight="700"
              >
                {{ node.count }}
              </text>
            </g>

            <text
              v-if="extraUserCount > 0"
              :x="LEFT_COL_X + LEFT_COL_W / 2"
              :y="(leftNodes[leftNodes.length - 1]?.y || CENTER_Y) + NODE_H + 16"
              fill="#ffffff4d"
              font-size="11"
              font-weight="600"
              text-anchor="middle"
            >
              +{{ extraUserCount }} 用户
            </text>

            <!-- Group counter -->
            <text x="280" y="212" text-anchor="middle" fill="#ffffffd9" font-size="28" font-weight="700">
              {{ onlineCount }}
            </text>
            <text x="280" y="232" text-anchor="middle" fill="#ffffff4d" font-size="12" font-weight="600">
              在线设备
            </text>

            <!-- Center: Enhanced core -->
            <g :transform="`translate(${CENTER_X}, ${CENTER_Y})`">
              <circle r="90" fill="rgba(0,194,168,0.03)" filter="url(#glow)" />
              <circle r="80" fill="none" stroke="rgba(0,194,168,0.08)" stroke-width="1" class="pulse-ring" />
              <circle r="65" fill="none" stroke="rgba(74,144,226,0.1)" stroke-width="1" class="pulse-ring-inner" />
              <circle r="52" fill="rgba(255,255,255,0.02)" stroke="rgba(0,194,168,0.15)" stroke-width="1" />
              <circle r="38" fill="rgba(255,255,255,0.02)" stroke="rgba(74,144,226,0.2)" stroke-width="1" />
              <g transform="translate(-20, -28) scale(0.625)" filter="url(#glow)">
                <path
                  d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z"
                  fill="url(#shield-grad)"
                  stroke="rgba(255,255,255,0.3)"
                  stroke-width="1"
                />
                <path
                  d="M28 32l4 4 8-8"
                  stroke="#fff"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"
                />
              </g>
              <text y="76" text-anchor="middle" fill="#ffffffd9" font-size="13" font-weight="700" letter-spacing="1">
                AI 安全护栏
              </text>
              <text y="92" text-anchor="middle" fill="#ffffff8a" font-size="10">
                {{ totalProtection }} 条防护规则
              </text>
            </g>

            <!-- Decorative dots -->
            <circle cx="435" cy="185" r="2" fill="#63e2b7" opacity="0.3" />
            <circle cx="420" cy="200" r="1.5" fill="#4A90E2" opacity="0.25" />
            <circle cx="570" cy="180" r="2" fill="#63e2b7" opacity="0.3" />
            <circle cx="585" cy="195" r="1.5" fill="#4A90E2" opacity="0.25" />
            <circle cx="480" cy="275" r="1.5" fill="#00C2A8" opacity="0.2" />
            <circle cx="520" cy="270" r="2" fill="#7363ff" opacity="0.2" />

            <!-- Right header -->
            <g class="topo-right-header">
              <text
                :x="RIGHT_COL_X + 56"
                :y="(rightNodes[0]?.y ?? CENTER_Y) - 14"
                fill="#ffffff4d"
                font-size="11"
                font-weight="700"
              >
                检测能力
              </text>
              <text
                :x="RIGHT_COL_X + RIGHT_COL_W - 50"
                :y="(rightNodes[0]?.y ?? CENTER_Y) - 14"
                fill="#ffffff4d"
                font-size="11"
                font-weight="700"
                text-anchor="middle"
              >
                命中数
              </text>
            </g>

            <!-- Right: capability rows -->
            <g v-for="(node, i) in rightNodes" :key="`rn-${i}`" class="topo-node-group">
              <title>{{ node.desc }}</title>
              <rect
                class="topo-card topo-card--right"
                :x="node.x"
                :y="node.y"
                :width="node.w"
                :height="node.h"
                rx="10"
                fill="rgba(255,255,255,0.04)"
                stroke="rgba(255,255,255,0.08)"
                stroke-width="1"
              />

              <rect
                class="topo-icon-box topo-icon-box--right"
                :x="node.x + 8"
                :y="node.y + 10"
                width="32"
                height="32"
                rx="10"
                fill="rgba(0,194,168,0.04)"
                stroke="rgba(0,194,168,0.12)"
                stroke-width="0.8"
              />

              <g
                :transform="`translate(${node.x + 12}, ${node.y + 14})`"
                fill="none"
                stroke="rgba(99,226,183,0.9)"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <g v-if="node.key === 'domain_block'">
                  <path d="M12 2.5l7 3.2v5c0 4.8-3 7.9-7 9.9-4-2-7-5.1-7-9.9v-5l7-3.2z" />
                  <path d="M8.8 11.8l2.2 2.2 4.2-4.2" />
                </g>
                <g v-else-if="node.key === 'sensitive_data'">
                  <path d="M1.8 12s3.8-5.5 10.2-5.5S22.2 12 22.2 12s-3.8 5.5-10.2 5.5S1.8 12 1.8 12z" />
                  <circle cx="12" cy="12" r="2.8" />
                </g>
                <g v-else-if="node.key === 'dangerous_cmd'">
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M7.2 10l3.2 2-3.2 2" />
                  <path d="M12.8 14h4.8" />
                </g>
                <g v-else-if="node.key === 'skill_audit'">
                  <path d="M12 3l8 4-8 4-8-4 8-4z" />
                  <path d="M4 7v10l8 4 8-4V7" />
                  <path d="M12 11v10" />
                </g>
                <g v-else-if="node.key === 'llm_intercept'">
                  <rect x="5" y="11" width="14" height="10" rx="2.5" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  <circle cx="12" cy="16" r="1" fill="rgba(99,226,183,0.9)" stroke="none" />
                </g>
                <g v-else>
                  <path d="M8 3h7l4 4v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                  <path d="M15 3v4h4" />
                  <rect x="10" y="13.5" width="6" height="4.5" rx="1.1" />
                  <path d="M11.5 13.5v-1a1.5 1.5 0 1 1 3 0v1" />
                </g>
              </g>

              <text
                :x="node.x + 52"
                :y="node.y + node.h / 2 + 4"
                fill="#ffffffd9"
                font-size="12.5"
                font-weight="600"
              >
                {{ node.name }}
              </text>

              <text
                :x="node.x + node.w - 50"
                :y="node.y + node.h / 2 + 7"
                text-anchor="middle"
                fill="#ffffffd9"
                font-size="18"
                font-weight="700"
              >
                {{ node.count || 0 }}
              </text>
            </g>
          </svg>

          <div class="topo-flow-bar">
            <span class="flow-pill flow-blue">接入数据</span>
            <span class="flow-line" />
            <span class="flow-pill flow-green">AI安全护栏</span>
            <span class="flow-line flow-line-active" />
            <span class="flow-pill flow-purple">检出风险</span>
          </div>
        </template>
      </div>

      <!-- Section 3: Charts + Rankings -->
      <div class="charts-row">
        <div class="charts-main">
          <NCard title="违规趋势" size="small" :segmented="{ content: true }" style="height: 100%">
            <template v-if="loading">
              <NSkeleton width="100%" :height="280" :sharp="false" />
            </template>
            <VChart
              v-else
              :option="violationChartOption"
              :autoresize="true"
              style="height: 100%; min-height: 280px"
            />
          </NCard>
        </div>

        <div class="charts-side">
          <NCard title="违规设备 Top 5" size="small" :segmented="{ content: true }" class="rank-card">
            <template v-if="loading">
              <NSkeleton v-for="i in 5" :key="i" width="100%" :height="28" :sharp="false" style="margin-bottom: 8px" />
            </template>
            <template v-else>
              <div v-if="!trend?.top_devices?.length" class="empty-hint">暂无数据</div>
              <div
                v-for="(device, idx) in (trend?.top_devices || []).slice(0, 5)"
                :key="device.device_id"
                class="rank-item"
              >
                <span
                  class="rank-badge"
                  :style="{ backgroundColor: idx < 3 ? rankColors[idx] : '#ffffff26', color: idx < 3 ? '#fff' : '#ffffffa0' }"
                >{{ idx + 1 }}</span>
                <span class="rank-name">{{ truncateId(device.device_id) }}</span>
                <span class="rank-count">{{ device.count }}</span>
              </div>
            </template>
          </NCard>

          <NCard title="高频工具 Top 5" size="small" :segmented="{ content: true }" class="rank-card" style="margin-top: 16px">
            <template v-if="loading">
              <NSkeleton v-for="i in 3" :key="i" width="100%" :height="28" :sharp="false" style="margin-bottom: 8px" />
            </template>
            <template v-else>
              <div v-if="!trend?.top_tools?.length" class="empty-hint">暂无数据</div>
              <div
                v-for="(tool, idx) in (trend?.top_tools || []).slice(0, 5)"
                :key="tool.tool_name"
                class="rank-item"
              >
                <span
                  class="rank-badge"
                  :style="{ backgroundColor: idx < 3 ? rankColors[idx] : '#ffffff26', color: idx < 3 ? '#fff' : '#ffffffa0' }"
                >{{ idx + 1 }}</span>
                <span class="rank-name">{{ tool.tool_name }}</span>
                <span class="rank-count">{{ tool.count }}</span>
              </div>
            </template>
          </NCard>
        </div>
      </div>

      <!-- Section 4: Recent Events -->
      <NCard title="最近违规事件" size="small" :segmented="{ content: true }" style="margin-top: 16px">
        <template v-if="loading">
          <NSkeleton width="100%" :height="200" :sharp="false" />
        </template>
        <template v-else>
          <NDataTable
            :columns="violationColumns"
            :data="violations"
            :bordered="false"
            :max-height="320"
            size="small"
            :pagination="false"
            striped
          />
          <NText v-if="!violations.length" depth="3" style="display: block; text-align: center; padding: 24px">
            暂无违规记录
          </NText>
        </template>
      </NCard>

    </template>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1400px;
  margin: 0 auto;
}

/* ── Section 1: Stat Cards ── */
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

@media (max-width: 900px) {
  .stat-row {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 540px) {
  .stat-row {
    grid-template-columns: 1fr;
  }
}

.stat-card {
  background: rgba(255, 255, 255, 0.04);
  border-left: 3px solid var(--accent, #63e2b7);
  border-radius: 6px;
  padding: 18px 20px;
  min-height: 90px;
  transition: background 0.2s;
}

.stat-card:hover {
  background: rgba(255, 255, 255, 0.07);
}

.stat-card__value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.2;
  color: #ffffffd9;
  font-variant-numeric: tabular-nums;
}

.stat-card__label {
  font-size: 13px;
  color: #ffffff8a;
  margin-top: 4px;
}

.stat-card__trend {
  font-size: 12px;
  margin-top: 6px;
  font-weight: 600;
}

.stat-card__sub {
  font-size: 11px;
  margin-top: 6px;
  color: #ffffff4d;
}

.trend--good { color: #63e2b7; }
.trend--bad { color: #e88080; }
.trend__sub { font-weight: 400; color: #ffffff4d; margin-left: 4px; }

/* ── Section 2: Topology ── */
.topo-section {
  margin-bottom: 0;
}

.topology-svg {
  width: 100%;
  display: block;
  height: auto;
  max-height: 420px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px 8px 0 0;
}

.topo-card,
.topo-icon-box {
  transition: fill 0.2s ease, stroke 0.2s ease, filter 0.2s ease;
}

.topo-node-group:hover .topo-card {
  fill: rgba(255, 255, 255, 0.06);
}

.topo-node-group:hover .topo-icon-box {
  fill: rgba(255, 255, 255, 0.06);
}

.pulse-ring,
.pulse-ring-inner {
  transform-origin: center;
}

.pulse-ring {
  animation: ring-shimmer 3s ease-in-out infinite;
}

.pulse-ring-inner {
  animation: ring-shimmer 3s ease-in-out infinite 1s;
}

@keyframes ring-shimmer {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.pulse-ring {
  animation: svg-pulse 3s ease-in-out infinite;
}

.pulse-ring-inner {
  animation: svg-pulse 3s ease-in-out infinite 0.5s;
}

@keyframes svg-pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.06); opacity: 1; }
}

.topo-flow-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  align-items: center;
  padding: 12px 24px;
  margin-top: -1px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-top: none;
  border-radius: 0 0 8px 8px;
}

.flow-pill {
  height: 28px;
  padding: 0 14px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.flow-blue {
  background: rgba(99, 164, 255, 0.12);
  color: #63a4ff;
}

.flow-green {
  background: rgba(0, 194, 168, 0.12);
  color: #00C2A8;
}

.flow-purple {
  background: rgba(115, 99, 255, 0.12);
  color: #7363ff;
}

.flow-line {
  height: 2px;
  width: 80px;
  background: rgba(255, 255, 255, 0.06);
}

.flow-line-active {
  background: linear-gradient(90deg, #00C2A8, #7363ff);
}

/* ── Section 3: Rankings ── */
.rank-card :deep(.n-card__content) {
  padding: 12px 16px !important;
}

.rank-item {
  display: flex;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid #ffffff0a;
}

.rank-item:last-child {
  border-bottom: none;
}

.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.rank-name {
  flex: 1;
  margin-left: 10px;
  font-size: 13px;
  color: #ffffffb3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rank-count {
  font-size: 14px;
  font-weight: 600;
  color: #ffffffd9;
  font-variant-numeric: tabular-nums;
  margin-left: 8px;
}

.empty-hint {
  text-align: center;
  color: #ffffff4d;
  padding: 20px 0;
  font-size: 13px;
}

/* ── Section 4: Table ── */
:deep(.row-odd td) {
  background: rgba(255, 255, 255, 0.02) !important;
}

/* ── Responsive topology ── */
@media (max-width: 600px) {
  .topology-svg {
    display: none;
  }

/* ── Section 3: Charts + Rankings ── */
.charts-row {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 16px;
  margin-top: 24px;
  align-items: stretch;
}

.charts-main {
  min-height: 340px;
}

.charts-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.charts-side .rank-card {
  flex: 1;
}

@media (max-width: 900px) {
  .charts-row {
    grid-template-columns: 1fr;
  }
}

.topo-flow-bar {
    display: none;
  }
}
</style>
