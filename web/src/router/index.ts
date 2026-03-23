import { createRouter, createWebHistory } from 'vue-router'
import AdminLayout from '../layout/AdminLayout.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('../views/LoginView.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      component: AdminLayout,
      redirect: '/dashboard',
      meta: { requiresAuth: true },
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('../views/DashboardView.vue'),
          meta: { title: '安全总览', icon: 'GridOutline', group: '监控' },
        },
        {
          path: 'violations',
          name: 'Violations',
          component: () => import('../views/ViolationsView.vue'),
          meta: { title: '违规记录', icon: 'AlertCircleOutline', group: '监控' },
        },
        {
          path: 'devices',
          name: 'Devices',
          component: () => import('../views/DevicesView.vue'),
          meta: { title: '设备管理', icon: 'DesktopOutline', group: '资产' },
        },
        {
          path: 'assets',
          name: 'Assets',
          component: () => import('../views/AssetsView.vue'),
          meta: { title: '资产总览', icon: 'LayersOutline', group: '资产' },
        },
        {
          path: 'reports',
          name: 'Reports',
          component: () => import('../views/ReportsView.vue'),
          meta: { title: '扫描报告', icon: 'DocumentTextOutline', group: '资产' },
        },
        {
          path: 'keys',
          name: 'Keys',
          component: () => import('../views/KeysView.vue'),
          meta: { title: 'Key 管理', icon: 'KeyOutline', group: '管理' },
        },
        {
          path: 'policy',
          name: 'Policy',
          component: () => import('../views/PolicyView.vue'),
          meta: { title: '策略管理', icon: 'ShieldCheckmarkOutline', group: '管理' },
        },
      ],
    },
  ],
})

router.beforeEach((to, _from, next) => {
  const isAuthenticated = localStorage.getItem('isAuthenticated') === '1'
  const apiKey = localStorage.getItem('adminApiKey')

  if (to.meta.requiresAuth !== false && (!isAuthenticated || !apiKey)) {
    next({ name: 'Login' })
  } else if (to.name === 'Login' && isAuthenticated && apiKey) {
    next({ name: 'Dashboard' })
  } else {
    next()
  }
})

export default router
