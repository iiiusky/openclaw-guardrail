<script setup lang="ts">
import { ref, onMounted, computed, h } from 'vue'
import {
  NGrid,
  NGridItem,
  NCard,
  NStatistic,
  NDataTable,
  NSpin,
  NResult,
  NTag,
  NText,
  NDrawer,
  NDrawerContent,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { getAssetDistribution, getDevices } from '../api'
import type { AssetDistItem, DeviceRecord } from '../api'

const loading = ref(true)
const error = ref('')
const skills = ref<AssetDistItem[]>([])
const plugins = ref<AssetDistItem[]>([])
const providers = ref<AssetDistItem[]>([])
const allDevices = ref<DeviceRecord[]>([])

const showDevicesDrawer = ref(false)
const drawerTitle = ref('')
const drawerDevices = ref<DeviceRecord[]>([])

const totalUniqueSkills = computed(() => skills.value.length)
const totalUniquePlugins = computed(() => plugins.value.length)
const totalUniqueProviders = computed(() => providers.value.length)

function showDeviceList(title: string, deviceIds: string[]) {
  drawerTitle.value = title
  const idSet = new Set(deviceIds)
  drawerDevices.value = allDevices.value.filter(d => idSet.has(d.device_id))
  showDevicesDrawer.value = true
}

function truncateId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : id
}

const deviceDetailColumns: DataTableColumns<DeviceRecord> = [
  { title: '用户', key: 'user_name', width: 100 },
  { title: '设备 ID', key: 'device_id', width: 120, ellipsis: { tooltip: true }, render: (row) => truncateId(row.device_id) },
  { title: '主机名', key: 'hostname', width: 140, ellipsis: { tooltip: true } },
  { title: '操作系统', key: 'os', width: 120, ellipsis: { tooltip: true }, render: (row) => row.platform || '-' },
  {
    title: '状态',
    key: 'last_seen',
    width: 100,
    render: (row) => {
      const online = row.last_seen && (Date.now() - new Date(row.last_seen).getTime() < 15 * 60 * 1000)
      return h(NTag, { size: 'small', type: online ? 'success' : 'default', bordered: false },
        { default: () => online ? '在线' : '离线' })
    },
  },
]

function createSkillColumns(): DataTableColumns<AssetDistItem> {
  return [
    { title: 'Skill', key: 'name', sorter: 'default', ellipsis: { tooltip: true } },
    { title: '设备数', key: 'device_count', width: 100, sorter: (a, b) => a.device_count - b.device_count },
    {
      title: '查看设备',
      key: 'actions',
      width: 100,
      render: (row) =>
        h(NTag, { size: 'small', type: 'info', style: 'cursor: pointer', onClick: () => showDeviceList(`Skill: ${row.name}`, row.devices) },
          { default: () => '查看' }),
    },
  ]
}

function createPluginColumns(): DataTableColumns<AssetDistItem> {
  return [
    { title: 'Plugin', key: 'name', sorter: 'default', ellipsis: { tooltip: true } },
    { title: '版本', key: 'version', width: 100, ellipsis: { tooltip: true } },
    { title: '设备数', key: 'device_count', width: 100, sorter: (a, b) => a.device_count - b.device_count },
    {
      title: '查看设备',
      key: 'actions',
      width: 100,
      render: (row) =>
        h(NTag, { size: 'small', type: 'info', style: 'cursor: pointer', onClick: () => showDeviceList(`Plugin: ${row.name}`, row.devices) },
          { default: () => '查看' }),
    },
  ]
}

function createProviderColumns(): DataTableColumns<AssetDistItem> {
  return [
    { title: 'Provider', key: 'name', sorter: 'default', ellipsis: { tooltip: true } },
    { title: 'Base URL', key: 'base_url', ellipsis: { tooltip: true } },
    { title: '设备数', key: 'device_count', width: 100, sorter: (a, b) => a.device_count - b.device_count },
    {
      title: '查看设备',
      key: 'actions',
      width: 100,
      render: (row) =>
        h(NTag, { size: 'small', type: 'info', style: 'cursor: pointer', onClick: () => showDeviceList(`Provider: ${row.name}`, row.devices) },
          { default: () => '查看' }),
    },
  ]
}

onMounted(async () => {
  try {
    const [distData, devicesData] = await Promise.all([
      getAssetDistribution(),
      getDevices(),
    ])
    skills.value = distData.skills || []
    plugins.value = distData.plugins || []
    providers.value = distData.providers || []
    allDevices.value = devicesData.devices || []
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
    <template v-else>
      <NGrid :x-gap="16" :y-gap="16" :cols="3" responsive="screen" item-responsive>
        <NGridItem span="3 m:1">
          <NCard size="small"><NStatistic label="Skills 种类" :value="totalUniqueSkills" /></NCard>
        </NGridItem>
        <NGridItem span="3 m:1">
          <NCard size="small"><NStatistic label="Plugins 种类" :value="totalUniquePlugins" /></NCard>
        </NGridItem>
        <NGridItem span="3 m:1">
          <NCard size="small"><NStatistic label="Providers 种类" :value="totalUniqueProviders" /></NCard>
        </NGridItem>
      </NGrid>

      <NCard title="Skills 分布" size="small" style="margin-top: 20px">
        <NDataTable :columns="createSkillColumns()" :data="skills" :bordered="false" :max-height="320" size="small" :pagination="false" />
        <NText v-if="!skills.length" depth="3" style="display: block; text-align: center; padding: 24px">暂无数据</NText>
      </NCard>

      <NCard title="Plugins 分布" size="small" style="margin-top: 16px">
        <NDataTable :columns="createPluginColumns()" :data="plugins" :bordered="false" :max-height="320" size="small" :pagination="false" />
        <NText v-if="!plugins.length" depth="3" style="display: block; text-align: center; padding: 24px">暂无数据</NText>
      </NCard>

      <NCard title="Providers 分布" size="small" style="margin-top: 16px">
        <NDataTable :columns="createProviderColumns()" :data="providers" :bordered="false" :max-height="320" size="small" :pagination="false" />
        <NText v-if="!providers.length" depth="3" style="display: block; text-align: center; padding: 24px">暂无数据</NText>
      </NCard>
    </template>
  </NSpin>

  <NDrawer v-model:show="showDevicesDrawer" :width="640" placement="right">
    <NDrawerContent :title="drawerTitle">
      <NDataTable
        :columns="deviceDetailColumns"
        :data="drawerDevices"
        :bordered="false"
        size="small"
        :pagination="{ pageSize: 10 }"
      />
      <NText v-if="!drawerDevices.length" depth="3" style="display: block; text-align: center; padding: 24px">
        暂无设备数据
      </NText>
    </NDrawerContent>
  </NDrawer>
</template>
