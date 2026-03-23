<script setup lang="ts">
import { ref, onMounted, h } from 'vue'
import {
  NCard,
  NDataTable,
  NSpin,
  NResult,
  NTag,
  NButton,
  NDrawer,
  NDrawerContent,
  NDescriptions,
  NDescriptionsItem,
  NSpace,
  NText,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { getDevices, getDeviceAsset } from '../api'
import type { DeviceRecord, AssetReport } from '../api'

const loading = ref(true)
const error = ref('')
const devices = ref<DeviceRecord[]>([])
const showDrawer = ref(false)
const drawerLoading = ref(false)
const selectedAsset = ref<AssetReport | null>(null)
const selectedDeviceId = ref('')

function truncateId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function formatTime(ts: string): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function isOnline(lastSeen: string): boolean {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < 15 * 60 * 1000
}

async function openAssetDrawer(deviceId: string) {
  selectedDeviceId.value = deviceId
  showDrawer.value = true
  drawerLoading.value = true
  selectedAsset.value = null
  try {
    selectedAsset.value = await getDeviceAsset(deviceId)
  } catch (e) {
    selectedAsset.value = null
  } finally {
    drawerLoading.value = false
  }
}

const columns: DataTableColumns<DeviceRecord> = [
  { title: '设备ID', key: 'device_id', width: 110, sorter: 'default', render: (row) => truncateId(row.device_id) },
  {
    title: '用户',
    key: 'user_name',
    width: 120,
    sorter: 'default',
    render: (row) =>
      h('span', { style: 'display: flex; align-items: center; gap: 6px' }, [
        h('span', {}, row.user_name || '-'),
        h('span', {
          style: {
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: isOnline(row.last_seen) ? '#63e2b7' : '#f0a020',
            boxShadow: isOnline(row.last_seen) ? '0 0 6px rgba(99,226,183,0.5)' : 'none',
            flexShrink: '0',
          },
        }),
      ]),
  },
  { title: '主机名', key: 'hostname', width: 130, ellipsis: { tooltip: true } },
  { title: '操作系统', key: 'os', width: 120, ellipsis: { tooltip: true }, render: (row) => (row as any).os || row.platform || '-' },
  { title: '激活时间', key: 'activated_at', width: 170, sorter: 'default', render: (row) => formatTime(row.activated_at) },
  {
    title: '最后活跃',
    key: 'last_seen',
    width: 170,
    sorter: 'default',
    render: (row) => formatTime(row.last_seen),
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render: (row) =>
      h(
        NButton,
        { size: 'small', quaternary: true, type: 'info', onClick: () => openAssetDrawer(row.device_id) },
        { default: () => '查看资产' },
      ),
  },
]

onMounted(async () => {
  try {
    const data = await getDevices()
    devices.value = data.devices || []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <NSpin :show="loading">
    <NResult v-if="error" status="error" :title="error" description="请检查 API 配置和网络连接" />
    <NCard v-else title="设备列表" size="small">
      <NDataTable
        :columns="columns"
        :data="devices"
        :bordered="false"
        :max-height="600"
        size="small"
        :pagination="{ pageSize: 20 }"
      />
    </NCard>
  </NSpin>

  <NDrawer v-model:show="showDrawer" :width="520" placement="right">
    <NDrawerContent :title="`设备资产 — ${truncateId(selectedDeviceId)}`">
      <NSpin :show="drawerLoading">
        <template v-if="selectedAsset">
          <NDescriptions label-placement="left" :column="1" bordered size="small">
            <NDescriptionsItem label="主机名">{{ selectedAsset.hostname }}</NDescriptionsItem>
            <NDescriptionsItem label="平台">{{ selectedAsset.platform }}</NDescriptionsItem>
            <NDescriptionsItem label="架构">{{ selectedAsset.arch }}</NDescriptionsItem>
            <NDescriptionsItem label="IP 地址">{{ selectedAsset.ip }}</NDescriptionsItem>
            <NDescriptionsItem label="OpenClaw 版本">{{ selectedAsset.openclaw_version }}</NDescriptionsItem>
            <NDescriptionsItem label="插件版本">{{ selectedAsset.plugin_version }}</NDescriptionsItem>
            <NDescriptionsItem label="上报时间">{{ formatTime(selectedAsset.received_at) }}</NDescriptionsItem>
          </NDescriptions>

          <NText strong style="display: block; margin: 16px 0 8px">Skills</NText>
          <NSpace>
            <NTag v-for="(s, i) in selectedAsset.skills_json" :key="i" size="small" type="info">{{ typeof s === 'string' ? s : ((s as any).name || (s as any).id || JSON.stringify(s)) }}</NTag>
            <NText v-if="!selectedAsset.skills_json?.length" depth="3">无</NText>
          </NSpace>

          <NText strong style="display: block; margin: 16px 0 8px">Plugins</NText>
          <NSpace>
            <NTag v-for="(p, i) in selectedAsset.plugins_json" :key="i" size="small" type="warning">{{ typeof p === 'string' ? p : ((p as any).name || (p as any).id || JSON.stringify(p)) }}</NTag>
            <NText v-if="!selectedAsset.plugins_json?.length" depth="3">无</NText>
          </NSpace>

          <NText strong style="display: block; margin: 16px 0 8px">Providers</NText>
          <div v-if="selectedAsset.providers_json?.length">
            <pre style="font-size: 12px; background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 0; max-height: 300px; overflow-y: auto">{{ JSON.stringify(selectedAsset.providers_json, null, 2) }}</pre>
          </div>
          <NText v-else depth="3">无</NText>

          <NText strong style="display: block; margin: 16px 0 8px">Gateway 配置</NText>
          <pre style="font-size: 12px; background: rgba(255,255,255,0.04); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 0">{{ JSON.stringify(selectedAsset.gateway_json, null, 2) }}</pre>
        </template>
        <NResult v-else-if="!drawerLoading" status="404" title="未找到资产信息" description="该设备尚未上报资产数据" />
      </NSpin>
    </NDrawerContent>
  </NDrawer>
</template>
