<script setup lang="ts">
import { ref, computed, h, onMounted } from 'vue'
import {
  NTabs,
  NTabPane,
  NCard,
  NSpace,
  NButton,
  NInput,
  NInputNumber,
  NDataTable,
  NTag,
  NDynamicTags,
  NModal,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NSelect,
  NSpin,
  NEmpty,
  NPopconfirm,
  NStatistic,
  NGrid,
  NGi,
  NText,
  NSwitch,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import {
  getPolicy,
  updatePolicy,
  getDevicePolicies,
  getDevicePolicy,
  updateDevicePolicy,
  deleteDevicePolicy,
  type PolicyData,
} from '../api'

// ── State ────────────────────────────────────────────────

const message = useMessage()

// Global policy
const loading = ref(false)
const saving = ref(false)
const policy = ref<PolicyData>({
  version: '',
  blocked_domains: [],
  allowed_domains: [],
  sensitive_keywords: [],
  dangerous_commands: [],
  protected_files: [],
  contacts: '',
  scan_interval_hours: 4,
})

// Command rule modal
const showCommandModal = ref(false)
const commandForm = ref({
  pattern: '',
  category: 'filesystem',
  severity: 'block',
  description: '',
})

const categoryOptions = [
  { label: '文件系统', value: 'filesystem' },
  { label: '网络', value: 'network' },
  { label: '进程', value: 'process' },
  { label: '权限', value: 'permission' },
  { label: '其他', value: 'other' },
]

const severityOptions = [
  { label: '阻止 (block)', value: 'block' },
  { label: '告警 (warn)', value: 'warn' },
]

// Device policies
const deviceLoading = ref(false)
const devicePolicies = ref<{ device_id: string; policy: Partial<PolicyData>; updated_at: string }[]>([])

// Device policy drawer
const showDeviceDrawer = ref(false)
const editingDeviceId = ref('')
const devicePolicyJson = ref('')
const devicePolicySaving = ref(false)
const deviceEditMode = ref<'form' | 'json'>('form')
const deviceFormPolicy = ref({
  audit_log: false,
  comm_log: false,
  blocked_domains: [] as string[],
  sensitive_keywords: [] as string[],
  dangerous_commands: [] as { pattern: string; category: string; severity: string; description: string }[],
  protected_files: [] as string[],
  scan_interval_hours: undefined as number | undefined,
})

// ── Computed ─────────────────────────────────────────────

const domainCount = computed(() => policy.value.blocked_domains.length)
const keywordCount = computed(() => policy.value.sensitive_keywords.length)
const commandCount = computed(() => policy.value.dangerous_commands.length)

// ── Helpers ──────────────────────────────────────────────

function formatDate(ts: string): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Global Policy ────────────────────────────────────────

async function fetchPolicy() {
  loading.value = true
  try {
    const data = await getPolicy()
    policy.value = {
      version: data.version || '',
      blocked_domains: data.blocked_domains || [],
      allowed_domains: data.allowed_domains || [],
      sensitive_keywords: data.sensitive_keywords || [],
      dangerous_commands: data.dangerous_commands || [],
      protected_files: data.protected_files || [],
      contacts: data.contacts || '',
      scan_interval_hours: data.scan_interval_hours ?? 4,
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`加载策略失败: ${err}`)
  } finally {
    loading.value = false
  }
}

async function handleSavePolicy() {
  saving.value = true
  try {
    await updatePolicy(policy.value)
    message.success('策略保存成功')
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`保存策略失败: ${err}`)
  } finally {
    saving.value = false
  }
}

// ── Command Rules ────────────────────────────────────────

const commandColumns: DataTableColumns<PolicyData['dangerous_commands'][number]> = [
  {
    title: '模式',
    key: 'pattern',
    width: 240,
    ellipsis: { tooltip: true },
    render(row) {
      return h(NText, { code: true, style: 'font-size: 12px' }, { default: () => row.pattern })
    },
  },
  {
    title: '分类',
    key: 'category',
    width: 100,
    render(row) {
      return h(NTag, { size: 'small', bordered: false }, { default: () => row.category })
    },
  },
  {
    title: '级别',
    key: 'severity',
    width: 90,
    render(row) {
      const type = row.severity === 'block' ? 'error' : 'warning'
      return h(NTag, { type, size: 'small' }, { default: () => row.severity })
    },
  },
  {
    title: '描述',
    key: 'description',
    ellipsis: { tooltip: true },
  },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render(_row, index) {
      return h(
        NButton,
        {
          size: 'small',
          quaternary: true,
          type: 'error',
          onClick: () => {
            policy.value.dangerous_commands.splice(index, 1)
          },
        },
        { default: () => '删除' },
      )
    },
  },
]

function openAddCommand() {
  commandForm.value = { pattern: '', category: 'filesystem', severity: 'block', description: '' }
  showCommandModal.value = true
}

function handleAddCommand() {
  if (!commandForm.value.pattern.trim()) {
    message.warning('请输入命令模式')
    return
  }
  policy.value.dangerous_commands.push({ ...commandForm.value })
  showCommandModal.value = false
}

// ── Device Policies ──────────────────────────────────────

async function fetchDevicePolicies() {
  deviceLoading.value = true
  try {
    const res = await getDevicePolicies()
    devicePolicies.value = res.devices || []
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`加载设备策略失败: ${err}`)
    devicePolicies.value = []
  } finally {
    deviceLoading.value = false
  }
}

function truncateId(id: string): string {
  if (!id) return '-'
  return id.length > 12 ? id.slice(0, 12) + '...' : id
}

const deviceColumns: DataTableColumns<typeof devicePolicies.value[number]> = [
  {
    title: '设备 ID',
    key: 'device_id',
    width: 160,
    ellipsis: { tooltip: true },
    render(row) {
      return h(NText, { code: true, style: 'font-size: 12px' }, { default: () => truncateId(row.device_id) })
    },
  },
  {
    title: '覆盖字段数',
    key: 'field_count',
    width: 120,
    render(row) {
      const count = Object.keys(row.policy || {}).length
      return h(NTag, { size: 'small', bordered: false }, { default: () => `${count} 项` })
    },
  },
  {
    title: '更新时间',
    key: 'updated_at',
    width: 180,
    render(row) {
      return formatDate(row.updated_at)
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    render(row) {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(
            NButton,
            {
              size: 'small',
              type: 'primary',
              quaternary: true,
              onClick: () => openEditDevice(row.device_id),
            },
            { default: () => '编辑' },
          ),
          h(
            NPopconfirm,
            {
              onPositiveClick: () => handleDeleteDevice(row.device_id),
            },
            {
              trigger: () =>
                h(
                  NButton,
                  { size: 'small', type: 'error', quaternary: true },
                  { default: () => '删除' },
                ),
              default: () => `确认删除设备 ${truncateId(row.device_id)} 的自定义策略？`,
            },
          ),
        ],
      })
    },
  },
]

async function openEditDevice(deviceId: string) {
  editingDeviceId.value = deviceId
  showDeviceDrawer.value = true
  devicePolicySaving.value = false
  deviceEditMode.value = 'form'

  let p: Record<string, unknown> = {}
  try {
    p = await getDevicePolicy(deviceId) as Record<string, unknown>
  } catch {
    const cached = devicePolicies.value.find((d) => d.device_id === deviceId)
    p = (cached?.policy || {}) as Record<string, unknown>
  }

  deviceFormPolicy.value = {
    audit_log: p.audit_log === true,
    comm_log: p.comm_log === true,
    blocked_domains: Array.isArray(p.blocked_domains) ? p.blocked_domains as string[] : [],
    sensitive_keywords: Array.isArray(p.sensitive_keywords) ? p.sensitive_keywords as string[] : [],
    dangerous_commands: Array.isArray(p.dangerous_commands) ? p.dangerous_commands as { pattern: string; category: string; severity: string; description: string }[] : [],
    protected_files: Array.isArray(p.protected_files) ? p.protected_files as string[] : [],
    scan_interval_hours: typeof p.scan_interval_hours === 'number' ? p.scan_interval_hours : undefined,
  }
  devicePolicyJson.value = JSON.stringify(p, null, 2)
}

async function handleSaveDevicePolicy() {
  let parsed: Record<string, unknown>
  if (deviceEditMode.value === 'form') {
    parsed = {}
    const f = deviceFormPolicy.value
    if (f.audit_log) parsed.audit_log = true
    if (f.comm_log) parsed.comm_log = true
    if (f.blocked_domains.length) parsed.blocked_domains = f.blocked_domains
    if (f.sensitive_keywords.length) parsed.sensitive_keywords = f.sensitive_keywords
    if (f.dangerous_commands.length) parsed.dangerous_commands = f.dangerous_commands
    if (f.protected_files.length) parsed.protected_files = f.protected_files
    if (f.scan_interval_hours !== undefined) parsed.scan_interval_hours = f.scan_interval_hours
  } else {
    try {
      parsed = JSON.parse(devicePolicyJson.value)
    } catch {
      message.error('JSON 格式无效，请检查后重试')
      return
    }
  }

  devicePolicySaving.value = true
  try {
    await updateDevicePolicy(editingDeviceId.value, parsed as Partial<PolicyData>)
    message.success('设备策略保存成功')
    showDeviceDrawer.value = false
    await fetchDevicePolicies()
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`保存设备策略失败: ${err}`)
  } finally {
    devicePolicySaving.value = false
  }
}

function switchDeviceEditMode(mode: 'form' | 'json') {
  if (mode === 'json' && deviceEditMode.value === 'form') {
    const obj: Record<string, unknown> = {}
    if (deviceFormPolicy.value.audit_log) obj.audit_log = true
    if (deviceFormPolicy.value.comm_log) obj.comm_log = true
    if (deviceFormPolicy.value.blocked_domains.length) obj.blocked_domains = deviceFormPolicy.value.blocked_domains
    if (deviceFormPolicy.value.sensitive_keywords.length) obj.sensitive_keywords = deviceFormPolicy.value.sensitive_keywords
    if (deviceFormPolicy.value.dangerous_commands.length) obj.dangerous_commands = deviceFormPolicy.value.dangerous_commands
    if (deviceFormPolicy.value.protected_files.length) obj.protected_files = deviceFormPolicy.value.protected_files
    if (deviceFormPolicy.value.scan_interval_hours !== undefined) obj.scan_interval_hours = deviceFormPolicy.value.scan_interval_hours
    devicePolicyJson.value = JSON.stringify(obj, null, 2)
  } else if (mode === 'form' && deviceEditMode.value === 'json') {
    try {
      const parsed = JSON.parse(devicePolicyJson.value)
      deviceFormPolicy.value = {
        audit_log: parsed.audit_log ?? false,
        comm_log: parsed.comm_log ?? false,
        blocked_domains: parsed.blocked_domains || [],
        sensitive_keywords: parsed.sensitive_keywords || [],
        dangerous_commands: parsed.dangerous_commands || [],
        protected_files: parsed.protected_files || [],
        scan_interval_hours: parsed.scan_interval_hours,
      }
    } catch {
      message.error('JSON 格式无效，无法切换到表单模式')
      return
    }
  }
  deviceEditMode.value = mode
}

async function handleDeleteDevice(deviceId: string) {
  try {
    await deleteDevicePolicy(deviceId)
    message.success('设备策略已删除')
    await fetchDevicePolicies()
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : '未知错误'
    message.error(`删除失败: ${err}`)
  }
}

// ── Lifecycle ────────────────────────────────────────────

onMounted(() => {
  fetchPolicy()
  fetchDevicePolicies()
})
</script>

<template>
  <div class="policy-view">
    <NTabs type="line" animated>
      <!-- ═══ Tab 1: 全局策略 ═══ -->
      <NTabPane name="global" tab="全局策略">
        <NSpin :show="loading">
          <!-- 策略概览 -->
          <NCard size="small" style="margin-bottom: 16px">
            <NGrid :cols="5" :x-gap="16" :y-gap="8" responsive="screen" item-responsive>
              <NGi>
                <NStatistic label="策略版本">
                  <NText code>{{ policy.version || '-' }}</NText>
                </NStatistic>
              </NGi>
              <NGi>
                <NStatistic label="黑名单域名" :value="domainCount" />
              </NGi>
              <NGi>
                <NStatistic label="敏感关键字" :value="keywordCount" />
              </NGi>
              <NGi>
                <NStatistic label="高危命令规则" :value="commandCount" />
              </NGi>
              <NGi>
                <NStatistic label="联系人">
                  <NText :depth="policy.contacts ? 1 : 3">{{ policy.contacts || '-' }}</NText>
                </NStatistic>
              </NGi>
            </NGrid>
          </NCard>

          <!-- 域名黑名单 -->
          <NCard title="域名黑名单" size="small" style="margin-bottom: 16px">
            <NDynamicTags v-model:value="policy.blocked_domains" type="error" />
            <NText v-if="policy.blocked_domains.length === 0" depth="3" style="font-size: 13px">
              暂无域名，点击 + 添加
            </NText>
          </NCard>

          <!-- 敏感关键字 -->
          <NCard title="敏感关键字" size="small" style="margin-bottom: 16px">
            <NDynamicTags v-model:value="policy.sensitive_keywords" type="warning" />
            <NText v-if="policy.sensitive_keywords.length === 0" depth="3" style="font-size: 13px">
              暂无关键字，点击 + 添加
            </NText>
          </NCard>

          <!-- 高危命令规则 -->
          <NCard title="高危命令规则" size="small" style="margin-bottom: 16px">
            <template #header-extra>
              <NButton size="small" type="primary" @click="openAddCommand">
                添加规则
              </NButton>
            </template>
            <NDataTable
              :columns="commandColumns"
              :data="policy.dangerous_commands"
              :bordered="false"
              size="small"
              :pagination="false"
              :scroll-x="600"
            />
            <NEmpty
              v-if="policy.dangerous_commands.length === 0"
              description="暂无命令规则"
              style="margin: 16px 0"
            />
          </NCard>

          <!-- 受保护文件 -->
          <NCard title="受保护文件" size="small" style="margin-bottom: 16px">
            <NDynamicTags v-model:value="policy.protected_files" type="info" />
            <NText v-if="policy.protected_files.length === 0" depth="3" style="font-size: 13px">
              暂无受保护文件，点击 + 添加
            </NText>
          </NCard>

          <!-- 其他配置 -->
          <NCard title="其他配置" size="small" style="margin-bottom: 16px">
            <NForm label-placement="left" label-width="auto">
              <NFormItem label="联系人">
                <NInput
                  v-model:value="policy.contacts"
                  placeholder="安全联系人，多人用逗号分隔"
                />
              </NFormItem>
              <NFormItem label="扫描间隔（小时）">
                <NInputNumber
                  v-model:value="policy.scan_interval_hours"
                  :min="1"
                  :max="168"
                  placeholder="扫描间隔"
                  style="width: 200px"
                />
              </NFormItem>
            </NForm>
          </NCard>

          <!-- 保存按钮 -->
          <div style="text-align: right; padding: 8px 0">
            <NButton type="primary" size="large" :loading="saving" @click="handleSavePolicy">
              保存策略
            </NButton>
          </div>
        </NSpin>
      </NTabPane>

      <!-- ═══ Tab 2: 设备策略覆盖 ═══ -->
      <NTabPane name="device" tab="设备策略覆盖">
        <NSpace vertical :size="16">
          <NSpace justify="space-between" align="center">
            <NText depth="3" style="font-size: 13px">
              设备策略覆盖会与全局策略进行 deep merge，优先级高于全局策略
            </NText>
            <NButton size="small" @click="fetchDevicePolicies" :loading="deviceLoading">
              刷新
            </NButton>
          </NSpace>

          <NSpin :show="deviceLoading">
            <NDataTable
              :columns="deviceColumns"
              :data="devicePolicies"
              :bordered="false"
              size="small"
              :pagination="{ pageSize: 20 }"
              :row-key="(row: typeof devicePolicies[number]) => row.device_id"
              :scroll-x="620"
            />
            <NEmpty
              v-if="!deviceLoading && devicePolicies.length === 0"
              description="暂无设备自定义策略"
              style="margin: 40px 0"
            />
          </NSpin>
        </NSpace>
      </NTabPane>
    </NTabs>

    <!-- ═══ Add Command Modal ═══ -->
    <NModal
      v-model:show="showCommandModal"
      preset="dialog"
      title="添加高危命令规则"
      positive-text="添加"
      negative-text="取消"
      style="width: 520px"
      @positive-click="handleAddCommand"
    >
      <NForm label-placement="left" label-width="80px" style="margin-top: 16px">
        <NFormItem label="模式">
          <NInput
            v-model:value="commandForm.pattern"
            placeholder="正则表达式，如 rm\s+-rf\s+/"
          />
        </NFormItem>
        <NFormItem label="分类">
          <NSelect
            v-model:value="commandForm.category"
            :options="categoryOptions"
          />
        </NFormItem>
        <NFormItem label="级别">
          <NSelect
            v-model:value="commandForm.severity"
            :options="severityOptions"
          />
        </NFormItem>
        <NFormItem label="描述">
          <NInput
            v-model:value="commandForm.description"
            type="textarea"
            placeholder="规则描述"
            :rows="2"
          />
        </NFormItem>
      </NForm>
    </NModal>

    <!-- ═══ Device Policy Drawer ═══ -->
    <NDrawer v-model:show="showDeviceDrawer" :width="640" placement="right">
      <NDrawerContent closable>
        <template #header>
          <NSpace justify="space-between" align="center" style="width: 100%">
            <NText strong>编辑设备策略 — {{ truncateId(editingDeviceId) }}</NText>
            <NSpace :size="4">
              <NButton
                :type="deviceEditMode === 'form' ? 'primary' : 'default'"
                size="tiny"
                @click="switchDeviceEditMode('form')"
                quaternary
              >表单</NButton>
              <NButton
                :type="deviceEditMode === 'json' ? 'primary' : 'default'"
                size="tiny"
                @click="switchDeviceEditMode('json')"
                quaternary
              >JSON</NButton>
            </NSpace>
          </NSpace>
        </template>

        <!-- Form Mode -->
        <template v-if="deviceEditMode === 'form'">
          <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 12px">
            仅配置需要覆盖全局策略的字段，未配置的项将继承全局策略
          </NText>

          <NCard title="调试" size="small" style="margin-bottom: 12px">
            <NSpace vertical :size="8">
              <NSpace align="center">
                <NSwitch v-model:value="deviceFormPolicy.audit_log" />
                <NText :depth="deviceFormPolicy.audit_log ? 1 : 3" style="font-size: 13px">
                  审计日志（记录所有 hook 交互详情到设备本地）
                </NText>
              </NSpace>
              <NSpace align="center">
                <NSwitch v-model:value="deviceFormPolicy.comm_log" />
                <NText :depth="deviceFormPolicy.comm_log ? 1 : 3" style="font-size: 13px">
                  通信日志（记录所有云端上报请求和响应到设备本地）
                </NText>
              </NSpace>
            </NSpace>
          </NCard>

          <NCard title="域名黑名单覆盖" size="small" style="margin-bottom: 12px">
            <NDynamicTags v-model:value="deviceFormPolicy.blocked_domains" type="error" />
            <NText v-if="!deviceFormPolicy.blocked_domains.length" depth="3" style="font-size: 12px">
              未覆盖，使用全局策略
            </NText>
          </NCard>

          <NCard title="敏感关键字覆盖" size="small" style="margin-bottom: 12px">
            <NDynamicTags v-model:value="deviceFormPolicy.sensitive_keywords" type="warning" />
            <NText v-if="!deviceFormPolicy.sensitive_keywords.length" depth="3" style="font-size: 12px">
              未覆盖，使用全局策略
            </NText>
          </NCard>

          <NCard title="受保护文件覆盖" size="small" style="margin-bottom: 12px">
            <NDynamicTags v-model:value="deviceFormPolicy.protected_files" type="info" />
            <NText v-if="!deviceFormPolicy.protected_files.length" depth="3" style="font-size: 12px">
              未覆盖，使用全局策略
            </NText>
          </NCard>

          <NCard title="扫描间隔覆盖" size="small" style="margin-bottom: 12px">
            <NInputNumber
              v-model:value="deviceFormPolicy.scan_interval_hours"
              :min="1" :max="168"
              placeholder="使用全局值"
              style="width: 200px"
              clearable
            />
            <NText depth="3" style="font-size: 12px; margin-left: 8px">小时</NText>
          </NCard>
        </template>

        <!-- JSON Mode -->
        <template v-else>
          <NText depth="3" style="font-size: 13px; display: block; margin-bottom: 12px">
            JSON 模式，仅包含需要覆盖的字段
          </NText>
          <NInput
            v-model:value="devicePolicyJson"
            type="textarea"
            placeholder='{ "audit_log": true }'
            :rows="24"
            style="font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace; font-size: 13px"
          />
        </template>

        <template #footer>
          <NSpace justify="end">
            <NButton @click="showDeviceDrawer = false">取消</NButton>
            <NButton type="primary" :loading="devicePolicySaving" @click="handleSaveDevicePolicy">
              保存
            </NButton>
          </NSpace>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.policy-view {
  padding: 4px;
}
</style>
