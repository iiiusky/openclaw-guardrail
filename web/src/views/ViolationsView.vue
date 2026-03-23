<script setup lang="ts">
import { ref, h, onMounted } from 'vue'
import {
  NSpace,
  NInput,
  NSelect,
  NButton,
  NDataTable,
  NSpin,
  NEmpty,
  NTag,
  NText,
  NCode,
  NPagination,
  NModal,
  NDescriptions,
  NDescriptionsItem,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { getViolations } from '../api'
import type { ViolationRecord } from '../api'

const message = useMessage()

const loading = ref(false)
const violations = ref<ViolationRecord[]>([])
const total = ref(0)

const filterDeviceId = ref('')
const filterDomain = ref('')
const filterAction = ref<string | null>(null)
const currentPage = ref(1)
const pageSize = ref(20)
const showDetailModal = ref(false)
const detailRow = ref<ViolationRecord | null>(null)

function openDetail(row: ViolationRecord) {
  detailRow.value = row
  showDetailModal.value = true
}

const actionOptions = [
  { label: '全部', value: '' },
  { label: 'blocked', value: 'blocked' },
  { label: 'detected', value: 'detected' },
]

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

const columns: DataTableColumns<ViolationRecord> = [
  {
    title: '时间',
    key: 'received_at',
    width: 180,
    sorter: (a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime(),
    render(row) {
      return formatDate(row.received_at)
    },
  },
  {
    title: '用户',
    key: 'user_name',
    width: 100,
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
    title: '触发点',
    key: 'hook_source',
    width: 110,
    render(row) {
      const labels: Record<string, string> = {
        llm_input: 'LLM 输入',
        llm_output: 'LLM 输出',
        before_tool_call: '工具调用前',
        after_tool_call: '工具调用后',
        fetch_interceptor: 'Fetch 拦截',
        skill_install: 'Skill 安装',
      }
      return h(NTag, { size: 'small', bordered: false }, { default: () => labels[row.hook_source] || row.hook_source || row.tool_name || '-' })
    },
  },
  {
    title: '分类',
    key: 'category',
    width: 110,
    render(row) {
      const labels: Record<string, { text: string; type: 'error' | 'warning' | 'info' | 'success' | 'default' }> = {
        domain_block: { text: '域名拦截', type: 'error' },
        sensitive_data: { text: '敏感数据', type: 'warning' },
        dangerous_cmd: { text: '高危命令', type: 'error' },
        skill_audit: { text: 'Skill 审计', type: 'info' },
        config_protect: { text: '配置保护', type: 'success' },
        llm_intercept: { text: 'LLM 拦截', type: 'warning' },
      }
      const item = labels[row.category]
      if (item) return h(NTag, { size: 'small', type: item.type, bordered: false }, { default: () => item.text })
      return row.category || '-'
    },
  },
  {
    title: '工具',
    key: 'tool_name',
    width: 120,
    render(row) {
      if (!row.tool_name || ['llm_input', 'llm_output', 'llm_request', 'llm_response'].includes(row.tool_name)) return '-'
      return row.tool_name
    },
  },
  {
    title: '匹配域名',
    key: 'matched_domain',
    width: 160,
    ellipsis: { tooltip: true },
    render(row) {
      if (!row.matched_domain) return h(NText, { depth: 3 }, { default: () => '-' })
      return h(NTag, { type: 'error', size: 'small', bordered: false }, { default: () => row.matched_domain })
    },
  },
  {
    title: '匹配关键字',
    key: 'matched_keyword',
    width: 160,
    ellipsis: { tooltip: true },
    render(row) {
      if (!row.matched_keyword) return h(NText, { depth: 3 }, { default: () => '-' })
      return h(NTag, { type: 'warning', size: 'small', bordered: false }, { default: () => row.matched_keyword })
    },
  },
  {
    title: '动作',
    key: 'action',
    width: 100,
    render(row) {
      const type = row.action === 'blocked' ? 'error' : 'warning'
      return h(NTag, { type, size: 'small' }, { default: () => row.action })
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render(row) {
      return h(NButton, { size: 'small', quaternary: true, type: 'info', onClick: () => openDetail(row) }, { default: () => '详情' })
    },
  },
]

const expandedRowKeys = ref<Array<string | number>>([])

function renderExpand(row: ViolationRecord) {
  return h(
    NCode,
    {
      code: row.context || JSON.stringify(row, null, 2),
      language: 'json',
      wordWrap: true,
      style: 'max-height: 300px; overflow: auto;',
    },
  )
}

function rowKey(row: ViolationRecord): number {
  return row.id
}

async function fetchViolations() {
  loading.value = true
  try {
    const params: Record<string, string | number> = {
      limit: pageSize.value,
      offset: (currentPage.value - 1) * pageSize.value,
    }
    if (filterDeviceId.value) params.device_id = filterDeviceId.value
    if (filterDomain.value) params.domain = filterDomain.value
    if (filterAction.value) params.action = filterAction.value
    const res = await getViolations(params)
    violations.value = res.violations || []
    total.value = res.total ?? violations.value.length
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`加载违规记录失败: ${err}`)
    violations.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function handleQuery() {
  currentPage.value = 1
  expandedRowKeys.value = []
  fetchViolations()
}

function handlePageChange(page: number) {
  currentPage.value = page
  expandedRowKeys.value = []
  fetchViolations()
}

function handlePageSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  expandedRowKeys.value = []
  fetchViolations()
}

onMounted(() => {
  fetchViolations()
})
</script>

<template>
  <div class="violations-view">
    <NSpace align="center" :wrap="true" style="margin-bottom: 16px;">
      <NInput
        v-model:value="filterDeviceId"
        placeholder="设备 ID 搜索"
        clearable
        style="width: 180px;"
        @keyup.enter="handleQuery"
      />
      <NInput
        v-model:value="filterDomain"
        placeholder="域名筛选"
        clearable
        style="width: 180px;"
        @keyup.enter="handleQuery"
      />
      <NSelect
        v-model:value="filterAction"
        :options="actionOptions"
        placeholder="动作筛选"
        style="width: 140px;"
      />
      <NButton type="primary" @click="handleQuery" :loading="loading">
        查询
      </NButton>
    </NSpace>

    <NSpin :show="loading">
      <NDataTable
        :columns="columns"
        :data="violations"
        :row-key="rowKey"
        :loading="loading"
        :expanded-row-keys="expandedRowKeys"
        @update:expanded-row-keys="(keys: Array<string | number>) => (expandedRowKeys = keys)"
        :render-expand="renderExpand"
        :scroll-x="1200"
        striped
        size="small"
      />

      <NEmpty
        v-if="!loading && violations.length === 0"
        description="暂无违规记录"
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
  </div>

  <NModal v-model:show="showDetailModal" preset="card" title="违规详情" style="width: 700px; max-width: 90vw">
    <template v-if="detailRow">
      <NDescriptions :column="2" label-placement="left" bordered size="small">
        <NDescriptionsItem label="时间">{{ formatDate(detailRow.received_at) }}</NDescriptionsItem>
        <NDescriptionsItem label="用户">{{ detailRow.user_name || '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="设备 ID">{{ detailRow.device_id }}</NDescriptionsItem>
        <NDescriptionsItem label="主机名">{{ detailRow.hostname || '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="触发点">{{ detailRow.hook_source || '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="分类">{{ detailRow.category || '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="工具">{{ detailRow.tool_name || '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="动作">
          <NTag :type="detailRow.action === 'blocked' ? 'error' : 'warning'" size="small">{{ detailRow.action }}</NTag>
        </NDescriptionsItem>
        <NDescriptionsItem label="匹配域名" :span="2">{{ detailRow.matched_domain || '-' }}</NDescriptionsItem>
        <NDescriptionsItem label="匹配关键字" :span="2">{{ detailRow.matched_keyword || '-' }}</NDescriptionsItem>
      </NDescriptions>
      <div style="margin-top: 12px">
        <NText strong style="display: block; margin-bottom: 6px">上下文</NText>
        <NCode :code="detailRow.context || '无'" language="text" word-wrap style="max-height: 300px; overflow: auto" />
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.violations-view {
  padding: 4px;
}
</style>
