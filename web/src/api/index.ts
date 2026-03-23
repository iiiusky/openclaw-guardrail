// API layer — native fetch, no axios dependency

const getBaseUrl = (): string =>
  localStorage.getItem('apiBaseUrl') || '/api/v1'

const getAuthHeaders = (): Record<string, string> => {
  const key = localStorage.getItem('adminApiKey') || ''
  return {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  }
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(`${getBaseUrl()}${path}`, {
    ...opts,
    headers: { ...getAuthHeaders(), ...(opts?.headers as Record<string, string>) },
  })
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      localStorage.removeItem('isAuthenticated')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
      throw new Error('认证失败，请重新登录')
    }
    throw new Error(`${resp.status}: ${await resp.text()}`)
  }
  return resp.json() as Promise<T>
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return qs ? `?${qs}` : ''
}

// ── Types ──────────────────────────────────────────────

export interface StatsResponse {
  total_reports: number
  total_devices: number
  total_violations: number
  recent_reports: ReportRecord[]
  recent_violations: ViolationRecord[]
  active_devices_24h: number
}

export interface DeviceRecord {
  device_id: string
  user_name: string
  hostname: string
  platform: string
  arch: string
  os: string
  activated_at: string
  last_seen: string
  activation_key: string
}

export interface ViolationRecord {
  id: number
  received_at: string
  timestamp: string
  device_id: string
  client_ip: string
  os: string
  hostname: string
  username: string
  user_name: string
  openclaw_version: string
  plugin_version: string
  session_id: string
  tool_name: string
  hook_source: string
  category: string
  matched_domain: string
  matched_keyword: string
  action: string
  context: string
}

export interface ReportRecord {
  id: number
  received_at: string
  timestamp: string
  device_id: string
  client_ip: string
  openclaw_version: string
  os: string
  user_name: string
  scan_type: string
  source: string
}

export interface ReportDetail extends ReportRecord {
  scan_json: Record<string, unknown>
  report_markdown: string
}

export interface KeyRecord {
  key: string
  user_name: string
  email: string
  feishu_id: string | null
  created_at: string
  used_at: string | null
  device_id: string | null
}

export interface AssetReport {
  id: number
  device_id: string
  machine_id: string
  hostname: string
  platform: string
  arch: string
  ip: string
  os: string
  openclaw_version: string
  plugin_version: string
  skills_json: Array<Record<string, unknown>>
  plugins_json: Array<Record<string, unknown>>
  providers_json: Array<Record<string, unknown>>
  gateway_json: Record<string, unknown>
  agents_json: Array<Record<string, unknown>>
  received_at: string
}

export interface PolicyData {
  version: string
  blocked_domains: string[]
  allowed_domains: string[]
  sensitive_keywords: string[]
  dangerous_commands: { pattern: string; category: string; description: string; severity: string }[]
  protected_files: string[]
  contacts: string
  scan_interval_hours: number
  audit_log?: boolean
}

// ── API functions ──────────────────────────────────────

export const getStats = () =>
  request<StatsResponse>('/stats')

export const getDevices = () =>
  request<{ devices: DeviceRecord[] }>('/devices')

export const getViolations = (params?: { device_id?: string; domain?: string; limit?: number; offset?: number }) =>
  request<{ violations: ViolationRecord[]; total: number }>(`/violations${buildQuery(params as Record<string, string | number | undefined>)}`)

export const getReports = (params?: { device_id?: string; limit?: number; offset?: number }) =>
  request<{ reports: ReportRecord[]; total: number }>(`/reports${buildQuery(params as Record<string, string | number | undefined>)}`)

export const getReportDetail = (id: number) =>
  request<ReportDetail>(`/reports/${id}`)

export const getKeys = () =>
  request<{ keys: KeyRecord[] }>('/keys')

export const createKey = (data: { user_name: string; email?: string }) =>
  request<KeyRecord>('/keys', { method: 'POST', body: JSON.stringify(data) })

export const revokeKey = (key: string) =>
  request<{ message: string }>(`/keys/${key}`, { method: 'DELETE' })

export const resetKey = (key: string) =>
  request<KeyRecord>(`/keys/${key}/reset`, { method: 'POST' })

export const getPolicy = () =>
  request<PolicyData>('/policy')

export const updatePolicy = (policy: Partial<PolicyData>) =>
  request<PolicyData>('/policy', { method: 'PUT', body: JSON.stringify(policy) })

export const getDevicePolicies = () =>
  request<{ devices: { device_id: string; policy: Partial<PolicyData>; updated_at: string }[] }>('/policy/devices')

export const updateDevicePolicy = (deviceId: string, policy: Partial<PolicyData>) =>
  request<{ message: string }>(`/policy/device/${deviceId}`, { method: 'PUT', body: JSON.stringify(policy) })

export const getDevicePolicy = (deviceId: string) =>
  request<Partial<PolicyData>>(`/policy/device/${deviceId}`)

export const deleteDevicePolicy = (deviceId: string) =>
  request<{ message: string }>(`/policy/device/${deviceId}`, { method: 'DELETE' })

export const getAssetReports = () =>
  request<{ total: number; assets: AssetReport[] }>('/asset-reports')

export const getDeviceAsset = (deviceId: string) =>
  request<AssetReport>(`/asset-reports/${deviceId}`)

export interface TrendStatsResponse {
  violation_trend: Array<{ date: string; count: number; blocked: number; detected: number }>
  report_trend: Array<{ date: string; count: number }>
  top_devices: Array<{ device_id: string; count: number }>
  top_tools: Array<{ tool_name: string; count: number }>
  today: {
    violations: number
    yesterday_violations: number
    reports: number
    active_devices: number
  }
}

export const getTrendStats = (days = 14) =>
  request<TrendStatsResponse>(`/stats/trend?days=${days}`)

export interface CapabilityStats {
  capabilities: Record<string, { total: number; blocked: number }>
  days: number
}

export const getCapabilityStats = (days = 14) =>
  request<CapabilityStats>(`/stats/capabilities?days=${days}`)

export interface AssetDistItem {
  id: string
  name: string
  device_count: number
  devices: string[]
  version?: string
  base_url?: string
}

export interface AssetDistribution {
  skills: AssetDistItem[]
  plugins: AssetDistItem[]
  providers: AssetDistItem[]
}

export const getAssetDistribution = () =>
  request<AssetDistribution>('/asset-distribution')
