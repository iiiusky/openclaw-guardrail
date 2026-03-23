<script setup lang="ts">
import { ref, h, onMounted, computed } from 'vue'
import {
  NCard,
  NSpace,
  NInput,
  NButton,
  NDataTable,
  NTag,
  NText,
  NAlert,
  NSpin,
  NEmpty,
  NPopconfirm,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { getKeys, createKey, revokeKey, resetKey } from '../api'
import type { KeyRecord } from '../api'

const message = useMessage()

const formUserName = ref('')
const formEmail = ref('')
const creating = ref(false)
const newlyCreatedKey = ref<string | null>(null)

const loading = ref(false)
const keys = ref<KeyRecord[]>([])
const actionLoadingKeys = ref<Set<string>>(new Set())

function formatDate(ts: string | null): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function truncateId(id: string | null): string {
  if (!id) return '-'
  return id.length > 8 ? id.slice(0, 8) + '...' : id
}

const canCreate = computed(() => formUserName.value.trim().length > 0)

const columns: DataTableColumns<KeyRecord> = [
  {
    title: 'Key',
    key: 'key',
    width: 300,
    render(row) {
      return h(NText, { code: true, style: 'font-family: monospace; font-size: 12px; word-break: break-all;' }, { default: () => row.key })
    },
  },
  {
    title: '用户',
    key: 'user_name',
    width: 100,
  },
  {
    title: '邮箱',
    key: 'email',
    width: 160,
    ellipsis: { tooltip: true },
  },
  {
    title: '创建时间',
    key: 'created_at',
    width: 170,
    sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    render(row) {
      return formatDate(row.created_at)
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 200,
    render(row) {
      if (!row.used_at) {
        return h(NTag, { type: 'success', size: 'small' }, { default: () => '未使用' })
      }
      return h(NSpace, { size: 4, align: 'center' }, {
        default: () => [
          h(NTag, { type: 'info', size: 'small' }, { default: () => '已使用' }),
          h(NText, { depth: 3, style: 'font-size: 12px;' }, {
            default: () => `${formatDate(row.used_at)} · ${truncateId(row.device_id)}`,
          }),
        ],
      })
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 180,
    render(row) {
      const isLoading = actionLoadingKeys.value.has(row.key)
      const buttons: ReturnType<typeof h>[] = []

      if (row.used_at) {
        buttons.push(
          h(
            NPopconfirm,
            { onPositiveClick: () => handleReset(row.key) },
            {
              trigger: () =>
                h(NButton, { size: 'small', type: 'warning', loading: isLoading, disabled: isLoading }, { default: () => '重置' }),
              default: () => '确定要重置此 Key 吗？设备绑定将被解除。',
            },
          ),
        )
      }

      buttons.push(
        h(
          NPopconfirm,
          { onPositiveClick: () => handleRevoke(row.key) },
          {
            trigger: () =>
              h(NButton, { size: 'small', type: 'error', loading: isLoading, disabled: isLoading }, { default: () => '吊销' }),
            default: () => '确定要吊销此 Key 吗？此操作不可恢复。',
          },
        ),
      )

      return h(NSpace, { size: 8 }, { default: () => buttons })
    },
  },
]

async function fetchKeys() {
  loading.value = true
  try {
    const res = await getKeys()
    keys.value = res.keys || []
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`加载 Key 列表失败: ${err}`)
    keys.value = []
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!canCreate.value) return
  creating.value = true
  newlyCreatedKey.value = null
  try {
    const res = await createKey({
      user_name: formUserName.value.trim(),
      email: formEmail.value.trim(),
    })
    newlyCreatedKey.value = res.key
    message.success('Key 创建成功')
    formUserName.value = ''
    formEmail.value = ''
    fetchKeys()
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`创建 Key 失败: ${err}`)
  } finally {
    creating.value = false
  }
}

async function handleRevoke(key: string) {
  actionLoadingKeys.value.add(key)
  try {
    await revokeKey(key)
    message.success('Key 已吊销')
    fetchKeys()
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`吊销失败: ${err}`)
  } finally {
    actionLoadingKeys.value.delete(key)
  }
}

async function handleReset(key: string) {
  actionLoadingKeys.value.add(key)
  try {
    await resetKey(key)
    message.success('Key 已重置')
    fetchKeys()
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`重置失败: ${err}`)
  } finally {
    actionLoadingKeys.value.delete(key)
  }
}

function copyKey() {
  if (!newlyCreatedKey.value) return
  navigator.clipboard.writeText(newlyCreatedKey.value).then(
    () => message.success('已复制到剪贴板'),
    () => message.error('复制失败，请手动复制'),
  )
}

function rowKey(row: KeyRecord): string {
  return row.key
}

onMounted(() => {
  fetchKeys()
})
</script>

<template>
  <div class="keys-view">
    <!-- Create Key Form -->
    <NCard title="生成激活 Key" size="small" style="margin-bottom: 20px;">
      <NSpace align="flex-end" :wrap="true">
        <div>
          <div style="font-size: 12px; opacity: 0.6; margin-bottom: 4px;">用户名 *</div>
          <NInput
            v-model:value="formUserName"
            placeholder="用户名（必填）"
            style="width: 160px;"
            @keyup.enter="handleCreate"
          />
        </div>
        <div>
          <div style="font-size: 12px; opacity: 0.6; margin-bottom: 4px;">邮箱</div>
          <NInput
            v-model:value="formEmail"
            placeholder="邮箱"
            style="width: 200px;"
          />
        </div>
        <NButton
          type="primary"
          :loading="creating"
          :disabled="!canCreate"
          @click="handleCreate"
        >
          生成
        </NButton>
      </NSpace>

      <NAlert
        v-if="newlyCreatedKey"
        type="success"
        title="Key 已生成"
        closable
        style="margin-top: 16px;"
        @close="newlyCreatedKey = null"
      >
        <NSpace align="center">
          <NText code style="font-family: monospace; font-size: 14px; word-break: break-all;">
            {{ newlyCreatedKey }}
          </NText>
          <NButton size="small" @click="copyKey">复制</NButton>
        </NSpace>
      </NAlert>
    </NCard>

    <!-- Keys Table -->
    <NSpin :show="loading">
      <NDataTable
        :columns="columns"
        :data="keys"
        :row-key="rowKey"
        :loading="loading"
        :scroll-x="1300"
        :pagination="{ pageSize: 15, showSizePicker: true, pageSizes: [10, 15, 30, 50] }"
        striped
        size="small"
      />

      <NEmpty
        v-if="!loading && keys.length === 0"
        description="暂无激活 Key"
        style="margin-top: 40px;"
      />
    </NSpin>
  </div>
</template>

<style scoped>
.keys-view {
  padding: 4px;
}
</style>
