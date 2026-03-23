<script setup lang="ts">
import { ref, computed, h, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NLayoutContent,
  NMenu,
  NIcon,
  NButton,
  NText,
} from 'naive-ui'
import type { MenuOption, MenuGroupOption } from 'naive-ui'
import {
  GridOutline,
  AlertCircleOutline,
  DesktopOutline,
  LayersOutline,
  DocumentTextOutline,
  KeyOutline,
  ShieldCheckmarkOutline,
  LogOutOutline,
} from '@vicons/ionicons5'
import type { Component } from 'vue'

const route = useRoute()
const router = useRouter()
const collapsed = ref(false)

const iconMap: Record<string, Component> = {
  GridOutline,
  AlertCircleOutline,
  DesktopOutline,
  LayersOutline,
  DocumentTextOutline,
  KeyOutline,
  ShieldCheckmarkOutline,
}

function renderIcon(iconName: string) {
  const IconComp = iconMap[iconName]
  if (!IconComp) return undefined
  return () => h(NIcon, null, { default: () => h(IconComp) })
}

const menuOptions = computed<(MenuOption | MenuGroupOption)[]>(() => {
  const routes = router.getRoutes().filter(r => r.meta?.title && r.meta?.group)
  const groups: Record<string, MenuOption[]> = {}

  for (const r of routes) {
    const group = r.meta.group as string
    if (!groups[group]) groups[group] = []
    groups[group].push({
      label: r.meta.title as string,
      key: r.path,
      icon: renderIcon(r.meta.icon as string),
    })
  }

  return [
    { type: 'group', label: '监控', key: 'g-monitor', children: groups['监控'] || [] },
    { type: 'group', label: '资产', key: 'g-assets', children: groups['资产'] || [] },
    { type: 'group', label: '管理', key: 'g-admin', children: groups['管理'] || [] },
  ] as (MenuOption | MenuGroupOption)[]
})

const activeKey = computed(() => route.path)

const pageTitle = computed(() => {
  const matched = route.matched[route.matched.length - 1]
  return (matched?.meta?.title as string) || 'OpenClaw 安全围栏'
})

function handleMenuUpdate(key: string) {
  router.push(key)
}

function handleLogout() {
  localStorage.removeItem('isAuthenticated')
  localStorage.removeItem('adminApiKey')
  router.push('/login')
}

watch(() => route.path, () => {
  document.title = `${pageTitle.value} - OpenClaw 安全围栏`
}, { immediate: true })
</script>

<template>
  <NLayout has-sider style="height: 100vh">
    <NLayoutSider
      bordered
      :collapsed="collapsed"
      collapse-mode="width"
      :collapsed-width="64"
      :width="240"
      show-trigger
      :native-scrollbar="false"
      @collapse="collapsed = true"
      @expand="collapsed = false"
      style="background: #18181c"
    >
      <div style="padding: 20px 16px 12px; text-align: center; white-space: nowrap; overflow: hidden">
        <NText strong style="font-size: 16px; color: #70c0e8; letter-spacing: 1px">
          {{ collapsed ? '🛡' : '🛡 安全围栏' }}
        </NText>
      </div>
      <NMenu
        :collapsed="collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
        :value="activeKey"
        @update:value="handleMenuUpdate"
      />
    </NLayoutSider>
    <NLayout>
      <NLayoutHeader bordered style="height: 56px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between">
        <NText strong style="font-size: 18px">{{ pageTitle }}</NText>
        <div style="display: flex; align-items: center; gap: 12px">
          <NText depth="3" style="font-size: 13px">管理员</NText>
          <NButton text type="tertiary" @click="handleLogout">
            <template #icon>
              <NIcon :component="LogOutOutline" />
            </template>
            退出登录
          </NButton>
        </div>
      </NLayoutHeader>
      <NLayoutContent
        :native-scrollbar="false"
        content-style="padding: 24px"
      >
        <router-view />
      </NLayoutContent>
    </NLayout>
  </NLayout>
</template>
