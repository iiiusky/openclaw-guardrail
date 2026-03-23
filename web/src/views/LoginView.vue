<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NInput,
  NButton,
  NAlert,
  NIcon,
  NSpace,
  NText,
} from 'naive-ui'
import { LockClosedOutline } from '@vicons/ionicons5'

const router = useRouter()

const apiBaseUrl = ref(localStorage.getItem('apiBaseUrl') || '/api/v1')
const adminApiKey = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function handleLogin() {
  errorMsg.value = ''

  if (!adminApiKey.value.trim()) {
    errorMsg.value = '请输入管理密钥'
    return
  }

  loading.value = true
  try {
    localStorage.setItem('apiBaseUrl', apiBaseUrl.value)
    localStorage.setItem('adminApiKey', adminApiKey.value.trim())

    const resp = await fetch(`${apiBaseUrl.value}/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminApiKey.value.trim()}`,
      },
    })

    if (!resp.ok) {
      const body = await resp.text()
      let detail = '认证失败'
      try {
        detail = JSON.parse(body).detail || detail
      } catch {
        // use default
      }
      throw new Error(detail)
    }

    localStorage.setItem('isAuthenticated', '1')
    router.push({ name: 'Dashboard' })
  } catch (err: unknown) {
    localStorage.removeItem('isAuthenticated')
    localStorage.removeItem('adminApiKey')
    errorMsg.value = err instanceof Error ? err.message : '认证失败，请检查密钥和服务地址'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-container">
      <NCard class="login-card" :bordered="false">
        <div class="login-header">
          <div class="icon-wrap">
            <NIcon :size="32" color="#70c0e8">
              <LockClosedOutline />
            </NIcon>
          </div>
          <NText class="login-title" strong>OpenClaw 安全围栏系统</NText>
          <NText class="login-subtitle" depth="3">请输入管理密钥登录</NText>
        </div>

        <NSpace vertical :size="20" class="login-form">
          <div>
            <NText depth="3" class="field-label">API 服务地址</NText>
            <NInput
              v-model:value="apiBaseUrl"
              placeholder="/api/v1"
              :disabled="loading"
            />
          </div>
          <div>
            <NText depth="3" class="field-label">管理密钥</NText>
            <NInput
              v-model:value="adminApiKey"
              type="password"
              show-password-on="click"
              placeholder="输入 Admin API Key"
              :disabled="loading"
              @keyup.enter="handleLogin"
            />
          </div>

          <NAlert v-if="errorMsg" type="error" :bordered="false">
            {{ errorMsg }}
          </NAlert>

          <NButton
            type="primary"
            block
            strong
            :loading="loading"
            :disabled="loading"
            @click="handleLogin"
          >
            登录
          </NButton>
        </NSpace>
      </NCard>

      <NText depth="3" class="login-footer">
        OpenClaw 安全围栏系统
      </NText>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #0a0a0e 0%, #111118 40%, #0d1520 100%);
  position: relative;
  overflow: hidden;
}

.login-page::before {
  content: '';
  position: absolute;
  top: -40%;
  right: -20%;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(112, 192, 232, 0.06) 0%, transparent 70%);
  pointer-events: none;
}

.login-page::after {
  content: '';
  position: absolute;
  bottom: -30%;
  left: -10%;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(99, 226, 183, 0.04) 0%, transparent 70%);
  pointer-events: none;
}

.login-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  z-index: 1;
}

.login-card {
  width: 420px;
  max-width: 90vw;
  background: rgba(24, 24, 28, 0.85);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.03) inset;
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(112, 192, 232, 0.1);
  border: 1px solid rgba(112, 192, 232, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.login-title {
  display: block;
  font-size: 22px;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.92);
  margin-bottom: 6px;
}

.login-subtitle {
  display: block;
  font-size: 14px;
}

.login-form {
  width: 100%;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
}

.login-footer {
  font-size: 12px;
}
</style>
