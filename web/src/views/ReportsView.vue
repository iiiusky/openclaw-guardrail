<script setup lang="ts">
import { ref, h, computed, onMounted } from 'vue'
import {
  NSpace,
  NInput,
  NButton,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NSpin,
  NEmpty,
  NTag,
  NText,
  NCode,
  NDivider,
  NPagination,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { getReports, getReportDetail } from '../api'
import type { ReportRecord } from '../api'

interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low'
  type: string
  location: string
  description: string
}

interface ScanSummary {
  total_findings: number
  critical?: number
  high?: number
  medium?: number
  low?: number
}

interface ScanData {
  summary?: ScanSummary
  findings?: Finding[]
}

interface ReportView extends ReportRecord {
  scan_json?: ScanData
  report_markdown?: string
}

interface AggRow {
  device_id: string
  user_name: string
  count: number
  latest: string
  openclaw_version: string
  reports: ReportRecord[]
  auto_count: number
  manual_count: number
}

const message = useMessage()

const loading = ref(false)
const reports = ref<ReportRecord[]>([])
const total = ref(0)

const filterDeviceId = ref('')
const currentPage = ref(1)
const pageSize = ref(20)

const expandedKeys = ref<Array<string | number>>([])

const drawerVisible = ref(false)
const detailLoading = ref(false)
const currentReport = ref<ReportView | null>(null)

function formatDate(ts: string): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function truncateId(id: string): string {
  if (!id) return '-'
  return id.length > 8 ? id.slice(0, 8) + '...' : id
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'critical': return '\u25CF'
    case 'high': return '\u25CF'
    case 'medium': return '\u25CF'
    case 'low': return '\u25CB'
    default: return '\u25CB'
  }
}

function severityTagType(severity: string): 'error' | 'warning' | 'info' | 'default' {
  switch (severity) {
    case 'critical': return 'error'
    case 'high': return 'warning'
    case 'medium': return 'warning'
    case 'low': return 'default'
    default: return 'default'
  }
}

// ─── Device Aggregation ──────────────────────────────────
const aggregatedData = computed<AggRow[]>(() => {
  const map = new Map<string, AggRow>()
  for (const r of reports.value) {
    const isAuto = r.source === 'scheduled' ? 1 : 0
    const existing = map.get(r.device_id)
    if (!existing) {
      map.set(r.device_id, {
        device_id: r.device_id,
        user_name: r.user_name || '',
        count: 1,
        latest: r.received_at,
        openclaw_version: r.openclaw_version,
        reports: [r],
        auto_count: isAuto,
        manual_count: 1 - isAuto,
      })
    } else {
      existing.count++
      existing.reports.push(r)
      existing.auto_count += isAuto
      existing.manual_count += (1 - isAuto)
      if (new Date(r.received_at) > new Date(existing.latest)) {
        existing.latest = r.received_at
        existing.openclaw_version = r.openclaw_version
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
})

// ─── Aggregated Columns ──────────────────────────────────
const aggregatedColumns: DataTableColumns<AggRow> = [
  {
    type: 'expand',
    renderExpand(row) {
      const subColumns: DataTableColumns<ReportRecord> = [
        { title: 'ID', key: 'id', width: 70 },
        {
          title: '接收时间',
          key: 'received_at',
          width: 180,
          render(r) { return formatDate(r.received_at) },
        },
        {
          title: '类型',
          key: 'source',
          width: 80,
          render(r) {
            return h(NTag, {
              size: 'small',
              type: r.source === 'scheduled' ? 'info' : 'success',
              bordered: false,
            }, {
              default: () => r.source === 'scheduled' ? '自动' : '手动',
            })
          },
        },
        {
          title: 'OpenClaw 版本',
          key: 'openclaw_version',
          width: 130,
          render(r) {
            return h(NTag, { size: 'small', bordered: false }, { default: () => r.openclaw_version || '-' })
          },
        },
        {
          title: '操作',
          key: 'actions',
          width: 100,
          render(r) {
            return h(
              NButton,
              { size: 'small', type: 'info', text: true, onClick: () => openDetail(r.id) },
              { default: () => '查看详情' },
            )
          },
        },
      ]
      const sorted = [...row.reports].sort(
        (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
      )
      return h(NDataTable, {
        columns: subColumns,
        data: sorted,
        bordered: false,
        size: 'small',
        rowKey: (r: ReportRecord) => r.id,
        maxHeight: 300,
      })
    },
  },
  {
    title: '用户',
    key: 'user_name',
    width: 120,
    render(row) {
      return row.user_name || '-'
    },
  },
  {
    title: '设备',
    key: 'device_id',
    width: 120,
    render(row) {
      return truncateId(row.device_id)
    },
  },
  {
    title: '报告数',
    key: 'count',
    width: 90,
    sorter: (a, b) => a.count - b.count,
    render(row) {
      return h(NTag, { type: 'info', size: 'small' }, { default: () => String(row.count) })
    },
  },
  {
    title: '类型分布',
    key: 'type_dist',
    width: 140,
    render(row) {
      return h(NSpace, { size: 4 }, {
        default: () => [
          row.auto_count > 0 ? h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => `自动 ${row.auto_count}` }) : null,
          row.manual_count > 0 ? h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => `手动 ${row.manual_count}` }) : null,
        ].filter(Boolean),
      })
    },
  },
  {
    title: '最近时间',
    key: 'latest',
    width: 180,
    sorter: (a, b) => new Date(a.latest).getTime() - new Date(b.latest).getTime(),
    render(row) {
      return formatDate(row.latest)
    },
  },
  {
    title: 'OpenClaw 版本',
    key: 'openclaw_version',
    width: 130,
    render(row) {
      return h(NTag, { size: 'small', bordered: false }, { default: () => row.openclaw_version || '-' })
    },
  },
]

const findingColumns: DataTableColumns<Finding> = [
  {
    title: '严重程度',
    key: 'severity',
    width: 100,
    render(row) {
      return h(NTag, { type: severityTagType(row.severity), size: 'small' }, {
        default: () => `${severityIcon(row.severity)} ${row.severity}`,
      })
    },
  },
  {
    title: '类型',
    key: 'type',
    width: 140,
  },
  {
    title: '位置',
    key: 'location',
    width: 180,
    ellipsis: { tooltip: true },
  },
  {
    title: '描述',
    key: 'description',
    ellipsis: { tooltip: true },
  },
]

async function fetchReports() {
  loading.value = true
  try {
    const params: Record<string, string | number> = {
      limit: pageSize.value,
      offset: (currentPage.value - 1) * pageSize.value,
    }
    if (filterDeviceId.value) params.device_id = filterDeviceId.value
    const res = await getReports(params)
    reports.value = res.reports || []
    total.value = res.total ?? reports.value.length
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`加载报告失败: ${err}`)
    reports.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function openDetail(id: number) {
  drawerVisible.value = true
  detailLoading.value = true
  currentReport.value = null
  try {
    const res = await getReportDetail(id)
    currentReport.value = res as ReportView
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`加载报告详情失败: ${err}`)
  } finally {
    detailLoading.value = false
  }
}

function handleQuery() {
  currentPage.value = 1
  fetchReports()
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchReports()
}

function handlePageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  fetchReports()
}

onMounted(() => {
  fetchReports()
})
</script>

<template>
  <div class="reports-view">
    <NSpace align="center" :wrap="true" style="margin-bottom: 16px;">
      <NInput
        v-model:value="filterDeviceId"
        placeholder="设备 ID 搜索"
        clearable
        style="width: 200px;"
        @keyup.enter="handleQuery"
      />
      <NButton type="primary" @click="handleQuery" :loading="loading">
        查询
      </NButton>
    </NSpace>

    <NSpin :show="loading">
      <NDataTable
        :columns="aggregatedColumns"
        :data="aggregatedData"
        :bordered="false"
        size="small"
        :row-key="(row: AggRow) => row.device_id"
        :expanded-row-keys="expandedKeys"
        @update:expanded-row-keys="(keys: Array<string | number>) => expandedKeys = keys"
        :scroll-x="900"
        striped
      />

      <NEmpty
        v-if="!loading && aggregatedData.length === 0"
        description="暂无扫描报告"
        style="margin-top: 40px;"
      />
    </NSpin>

    <NPagination
      v-if="total > 0"
      :page="currentPage"
      :page-size="pageSize"
      :page-count="Math.ceil(total / pageSize)"
      :page-sizes="[20, 50, 100]"
      show-size-picker
      style="margin-top: 16px; justify-content: flex-end;"
      @update:page="handlePageChange"
      @update:page-size="handlePageSizeChange"
    />

    <!-- Detail Drawer -->
    <NDrawer v-model:show="drawerVisible" :width="640" placement="right">
      <NDrawerContent title="报告详情" closable>
        <NSpin :show="detailLoading">
          <template v-if="currentReport">
            <!-- Basic Info -->
            <NCard title="基本信息" size="small" style="margin-bottom: 16px;">
              <NDescriptions :column="2" label-placement="left" bordered size="small">
                <NDescriptionsItem label="接收时间">
                  {{ formatDate(currentReport.received_at) }}
                </NDescriptionsItem>
                <NDescriptionsItem label="设备 ID">
                  <NText code>{{ currentReport.device_id }}</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="OpenClaw 版本">
                  {{ currentReport.openclaw_version || '-' }}
                </NDescriptionsItem>
              </NDescriptions>
            </NCard>

            <!-- Scan Summary -->
            <NCard
              v-if="currentReport.scan_json?.summary"
              title="扫描摘要"
              size="small"
              style="margin-bottom: 16px;"
            >
              <NSpace :size="16">
                <NTag size="medium">
                  总发现: {{ currentReport.scan_json.summary.total_findings ?? 0 }}
                </NTag>
                <NTag type="error" size="medium" v-if="currentReport.scan_json.summary.critical">
                  严重: {{ currentReport.scan_json.summary.critical }}
                </NTag>
                <NTag type="warning" size="medium" v-if="currentReport.scan_json.summary.high">
                  高危: {{ currentReport.scan_json.summary.high }}
                </NTag>
                <NTag type="warning" size="medium" v-if="currentReport.scan_json.summary.medium">
                  中危: {{ currentReport.scan_json.summary.medium }}
                </NTag>
                <NTag size="medium" v-if="currentReport.scan_json.summary.low">
                  低危: {{ currentReport.scan_json.summary.low }}
                </NTag>
              </NSpace>
            </NCard>

            <!-- Findings Table -->
            <NCard
              v-if="currentReport.scan_json?.findings?.length"
              title="风险明细"
              size="small"
              style="margin-bottom: 16px;"
            >
              <NDataTable
                :columns="findingColumns"
                :data="currentReport.scan_json.findings"
                :row-key="(_row: Finding) => _row.type + _row.location"
                size="small"
                :max-height="300"
                striped
              />
            </NCard>

            <!-- Raw Markdown / JSON -->
            <NDivider />
            <NCard title="原始数据" size="small">
              <NCode
                :code="currentReport.report_markdown || JSON.stringify(currentReport.scan_json, null, 2) || '无数据'"
                :language="currentReport.report_markdown ? 'markdown' : 'json'"
                word-wrap
                style="max-height: 400px; overflow: auto;"
              />
            </NCard>
          </template>

          <NEmpty
            v-if="!detailLoading && !currentReport"
            description="加载失败"
            style="margin-top: 60px;"
          />
        </NSpin>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.reports-view {
  padding: 4px;
}
</style>
