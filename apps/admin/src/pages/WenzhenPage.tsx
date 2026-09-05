import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CloudUploadOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type {
  AcceptedWenzhenDifference,
  AdminBirthplaceResult,
  BaziFlowSelection,
  WenzhenCaptureDraft,
  WenzhenDiffResponse,
  WenzhenDifferenceClassification,
  WenzhenDifferenceClassificationSelection,
  WenzhenMismatch,
} from '../types'
import {
  compareWenzhen,
  getBaziFlow,
  getWenzhenDiff,
  saveWenzhenFixture,
  searchBirthplaces,
  uploadWenzhenEvidence,
} from '../api'
import {
  buildWenzhenDynamicExpectedTemplateFromFlowSelection,
  buildWenzhenExpectedFromAdminInput,
  buildWenzhenExpectedJsonWithDynamicTemplate,
  buildWenzhenFlowQueryFromAdminInput,
  canApplyWenzhenFlowTemplateResponse,
  currentLocalDateTime,
  emptyWenzhenAcceptanceSelections,
  formatWenzhenAssertionCoverage,
  validateWenzhenAcceptance,
  wenzhenComparisonFingerprint,
  wenzhenDifferenceClassificationLabels,
  wenzhenSourceUrl,
} from '../lib/wenzhen'

const { TextArea } = Input
const { Text } = Typography

const GENDER_OPTIONS: { label: string; value: 'male' | 'female' }[] = [
  { label: '男', value: 'male' },
  { label: '女', value: 'female' },
]

const CALENDAR_OPTIONS: { label: string; value: 'solar' | 'lunar' }[] = [
  { label: '公历', value: 'solar' },
  { label: '农历', value: 'lunar' },
]

const DST_OPTIONS: { label: string; value: 'auto' | 'ignore' }[] = [
  { label: '自动', value: 'auto' },
  { label: '忽略', value: 'ignore' },
]

const DAY_BOUNDARY_OPTIONS: { label: string; value: 'midnight' | 'zi-hour-start' }[] = [
  { label: '子夜 (00:00)', value: 'midnight' },
  { label: '子时初 (23:00)', value: 'zi-hour-start' },
]

const LUCK_METHOD_OPTIONS: { label: string; value: 'sect1' | 'sect2' }[] = [
  { label: '流派一', value: 'sect1' },
  { label: '流派二', value: 'sect2' },
]

const CLASSIFICATION_SELECT_OPTIONS: { label: string; value: WenzhenDifferenceClassification }[] = (
  Object.entries(wenzhenDifferenceClassificationLabels) as [WenzhenDifferenceClassification, string][]
).map(([value, label]) => ({ label, value }))

function initialDraft(): WenzhenCaptureDraft {
  return {
    sampleId: '',
    capturedAt: currentLocalDateTime(),
    sourceUrl: wenzhenSourceUrl,
    evidenceRef: '',
    flowTargetDate: null,
    flowTargetTime: null,
    calendarSystem: 'solar',
    lunarLeapMonth: false,
    date: '',
    time: '',
    placeCode: '',
    placeLabel: '',
    placeLongitude: undefined,
    placeLatitude: undefined,
    placeTimezone: '',
    placeCoordinateStatus: '',
    placeCoordinateSource: '',
    placeCoordinateLicense: '',
    placeDataVersion: '',
    gender: 'male',
    useTrueSolarTime: true,
    dstPolicy: 'auto',
    dayBoundary: 'midnight',
    luckMethod: 'sect1',
    pillars: '',
    expectedJson: '{}',
  }
}

function parsePillars(input: string): string[] {
  return input
    .split(/[\s,，、]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function birthObjectFromDraft(draft: WenzhenCaptureDraft) {
  return {
    calendarSystem: draft.calendarSystem,
    lunarLeapMonth: draft.lunarLeapMonth,
    date: draft.date,
    time: draft.time,
    place: {
      code: draft.placeCode,
      label: draft.placeLabel,
      longitude: draft.placeLongitude,
      latitude: draft.placeLatitude,
      timezone: draft.placeTimezone,
      coordinateStatus: draft.placeCoordinateStatus,
      coordinateSource: draft.placeCoordinateSource,
      coordinateLicense: draft.placeCoordinateLicense,
      dataVersion: draft.placeDataVersion,
    },
    gender: draft.gender,
    useTrueSolarTime: draft.useTrueSolarTime,
    dstPolicy: draft.dstPolicy,
    dayBoundary: draft.dayBoundary,
    luckMethod: draft.luckMethod,
  }
}

export default function WenzhenPage() {
  const { message } = App.useApp()

  // --- Diff summary state ---
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffUnavailable, setDiffUnavailable] = useState(false)
  const [diff, setDiff] = useState<WenzhenDiffResponse | null>(null)

  // --- Draft form state ---
  const [draft, setDraft] = useState<WenzhenCaptureDraft>(initialDraft)
  // Mirror of the latest draft so async guards (e.g. flow-fill) compare against
  // current state rather than a stale closure captured before the await.
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  // --- Birthplace search ---
  const [birthplaceQuery, setBirthplaceQuery] = useState('')
  const [birthplaceOptions, setBirthplaceOptions] = useState<AdminBirthplaceResult[]>([])
  const [birthplaceSearching, setBirthplaceSearching] = useState(false)
  const birthplaceTimer = useRef<number | null>(null)

  // --- Source (not in WenzhenCaptureDraft; managed separately) ---
  const [source, setSource] = useState('')

  // --- Evidence ---
  const [evidenceUploading, setEvidenceUploading] = useState(false)
  const [evidenceMeta, setEvidenceMeta] = useState<{ sha256: string; mimeType: string; size: number } | null>(null)

  // --- Flow query ---
  const [flowLoading, setFlowLoading] = useState(false)
  const [lastFlowSelection, setLastFlowSelection] = useState<BaziFlowSelection | null>(null)

  // --- Compare report ---
  const [comparing, setComparing] = useState(false)
  const [mismatches, setMismatches] = useState<WenzhenMismatch[]>([])
  const [matched, setMatched] = useState<boolean | null>(null)

  // --- Acceptance selections ---
  const [acceptanceReasons, setAcceptanceReasons] = useState<Record<string, string>>({})
  const [acceptanceClassifications, setAcceptanceClassifications] = useState<
    Record<string, WenzhenDifferenceClassificationSelection>
  >({})

  // --- Save fixture ---
  const [saving, setSaving] = useState(false)

  // ---- Diff summary loader ----
  const loadDiff = useCallback(async () => {
    setDiffLoading(true)
    setDiffError(null)
    setDiffUnavailable(false)
    try {
      const response = await getWenzhenDiff()
      setDiff(response)
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 503) {
        setDiffUnavailable(true)
      } else {
        const msg = error instanceof Error ? error.message : '加载差异摘要失败'
        setDiffError(msg)
      }
    } finally {
      setDiffLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDiff()
  }, [loadDiff])

  // ---- Birthplace debounced search ----
  useEffect(() => {
    if (birthplaceTimer.current) window.clearTimeout(birthplaceTimer.current)
    const q = birthplaceQuery.trim()
    if (!q) {
      setBirthplaceOptions([])
      return
    }
    birthplaceTimer.current = window.setTimeout(() => {
      setBirthplaceSearching(true)
      searchBirthplaces(q, 12)
        .then((response) => {
          setBirthplaceOptions(response.items ?? [])
        })
        .catch((error) => {
          const msg = error instanceof Error ? error.message : '出生地检索失败'
          message.error(msg)
        })
        .finally(() => setBirthplaceSearching(false))
    }, 300)
    return () => {
      if (birthplaceTimer.current) window.clearTimeout(birthplaceTimer.current)
    }
  }, [birthplaceQuery, message])

  function handleBirthplaceSelect(value: string, option: unknown) {
    const item = (option as { data?: AdminBirthplaceResult })?.data
    if (!item) return
    setDraft((prev) => ({
      ...prev,
      placeCode: item.district.code,
      placeLabel: `${item.province.name}/${item.city.name}/${item.district.name}`,
      placeLongitude: item.district.longitude,
      placeLatitude: item.district.latitude,
      placeTimezone: item.city.timezone ?? '',
      placeCoordinateStatus: item.district.coordinate?.confidence ?? '',
      placeCoordinateSource: item.district.coordinate?.sourceLabel ?? '',
      placeCoordinateLicense: item.district.coordinate?.license ?? '',
      placeDataVersion: item.datasetVersion ?? '',
    }))
  }

  // ---- Evidence upload ----
  async function handleEvidenceUpload(file: File) {
    setEvidenceUploading(true)
    try {
      const response = await uploadWenzhenEvidence(file)
      setDraft((prev) => ({ ...prev, evidenceRef: response.evidenceRef }))
      setEvidenceMeta({ sha256: response.sha256, mimeType: response.mimeType, size: response.size })
      message.success('凭证上传成功')
    } catch (error) {
      const msg = error instanceof Error ? error.message : '凭证上传失败'
      message.error(msg)
    } finally {
      setEvidenceUploading(false)
    }
    return false
  }

  // ---- Flow query template fill ----
  async function handleFlowFill() {
    let flowQuery: ReturnType<typeof buildWenzhenFlowQueryFromAdminInput>
    try {
      flowQuery = buildWenzhenFlowQueryFromAdminInput(draft.flowTargetDate, draft.flowTargetTime)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '流盘参数无效')
      return
    }
    if (!flowQuery) {
      message.info('请填写流盘目标日期后再尝试。')
      return
    }
    const fingerprint = wenzhenComparisonFingerprint(draft)
    setFlowLoading(true)
    try {
      const birth = birthObjectFromDraft(draft)
      const response = await getBaziFlow({ birth, query: flowQuery })
      const selection = response.flow.selection
      if (!canApplyWenzhenFlowTemplateResponse(draftRef.current, fingerprint)) {
        message.warning('表单内容已变化，未应用流盘模板以避免覆盖编辑。')
        return
      }
      const nextExpected = buildWenzhenExpectedJsonWithDynamicTemplate(draft.expectedJson, selection)
      setDraft((prev) => ({ ...prev, expectedJson: nextExpected }))
      setLastFlowSelection(selection)
      message.success('已用流盘结果填充扩展 expected 模板。')
    } catch (error) {
      const msg = error instanceof Error ? error.message : '获取流盘数据失败'
      message.error(msg)
    } finally {
      setFlowLoading(false)
    }
  }

  // ---- Compare ----
  async function handleCompare() {
    let expected: unknown
    try {
      const pillars = parsePillars(draft.pillars)
      expected = buildWenzhenExpectedFromAdminInput(pillars, draft.expectedJson)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'expected 输入校验失败')
      return
    }
    if (!draft.sampleId.trim()) {
      message.error('请填写样例 ID。')
      return
    }
    if (!source.trim()) {
      message.error('请填写来源标识。')
      return
    }
    setComparing(true)
    try {
      let flowQuery: unknown
      try {
        flowQuery = buildWenzhenFlowQueryFromAdminInput(draft.flowTargetDate, draft.flowTargetTime)
      } catch {
        flowQuery = undefined
      }
      const response = await compareWenzhen({
        sampleId: draft.sampleId.trim(),
        source: source.trim(),
        birth: birthObjectFromDraft(draft),
        flowQuery,
        expected,
      })
      setMatched(response.report.matched)
      setMismatches(response.report.mismatches)
      const selections = emptyWenzhenAcceptanceSelections(response.report.mismatches.map((m) => m.path))
      setAcceptanceReasons(selections.reasons)
      setAcceptanceClassifications(selections.classifications)
      if (response.report.matched) {
        message.success('对比完全匹配。')
      } else {
        message.warning(`发现 ${response.report.mismatches.length} 处差异，请逐条审核。`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '对比请求失败'
      message.error(msg)
    } finally {
      setComparing(false)
    }
  }

  // ---- Save fixture ----
  async function handleSave() {
    if (!draft.evidenceRef) {
      message.error('请先上传截图凭证。')
      return
    }
    let pillars: string[]
    let expected: unknown
    try {
      pillars = parsePillars(draft.pillars)
      expected = buildWenzhenExpectedFromAdminInput(pillars, draft.expectedJson)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'expected 输入校验失败')
      return
    }

    let acceptedDifferences: AcceptedWenzhenDifference[] | undefined
    let status: 'verified' | 'accepted-difference'

    if (mismatches.length > 0) {
      const validation = validateWenzhenAcceptance(mismatches, acceptanceReasons, acceptanceClassifications)
      if (!validation.ok) {
        message.error(validation.message)
        return
      }
      acceptedDifferences = validation.acceptedDifferences
      status = 'accepted-difference'
    } else {
      status = 'verified'
    }

    let flowQuery: unknown
    try {
      flowQuery = buildWenzhenFlowQueryFromAdminInput(draft.flowTargetDate, draft.flowTargetTime)
    } catch {
      flowQuery = undefined
    }

    setSaving(true)
    try {
      await saveWenzhenFixture({
        sampleId: draft.sampleId.trim(),
        source: source.trim(),
        status,
        capturedAt: draft.capturedAt,
        sourceUrl: draft.sourceUrl,
        evidenceRef: draft.evidenceRef,
        flowQuery,
        birth: birthObjectFromDraft(draft),
        expected,
        acceptedDifferences,
      })
      message.success('样例 fixture 已保存。')
      void loadDiff()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '保存失败'
      message.error(msg)
    } finally {
      setSaving(false)
    }
  }

  // ---- Mismatch table columns ----
  const mismatchColumns: ColumnsType<WenzhenMismatch> = useMemo(
    () => [
      { title: '路径', dataIndex: 'path', key: 'path', width: 220 },
      { title: '分类', dataIndex: 'category', key: 'category', width: 140 },
      {
        title: '期望',
        dataIndex: 'expected',
        key: 'expected',
        render: (value: unknown) => <Text code>{typeof value === 'string' ? value : JSON.stringify(value)}</Text>,
      },
      {
        title: '实际',
        dataIndex: 'actual',
        key: 'actual',
        render: (value: unknown) => <Text code>{typeof value === 'string' ? value : JSON.stringify(value)}</Text>,
      },
    ],
    [],
  )

  // ---- Coverage rows ----
  const coverageRows = useMemo(() => (diff ? formatWenzhenAssertionCoverage(diff.coverage) : []), [diff])

  // ---- Pending samples columns ----
  const pendingColumns: ColumnsType<{ sampleId?: string; source?: string; notes?: string }> = useMemo(
    () => [
      { title: '样例 ID', dataIndex: 'sampleId', key: 'sampleId' },
      { title: '来源', dataIndex: 'source', key: 'source' },
      { title: '备注', dataIndex: 'notes', key: 'notes' },
    ],
    [],
  )

  const birthplaceSelectOptions = useMemo(
    () =>
      birthplaceOptions
        .filter((item) => item.selectable)
        .map((item) => ({
          label: `${item.province.name} / ${item.city.name} / ${item.district.name}`,
          value: item.district.code,
          data: item,
        })),
    [birthplaceOptions],
  )

  return (
    <Space orientation="vertical" size={24} style={{ width: '100%' }}>
      {/* ===== 1. Diff summary ===== */}
      <Card
        title="差异摘要"
        extra={
          <Button icon={<ReloadOutlined />} loading={diffLoading} onClick={() => void loadDiff()}>
            刷新
          </Button>
        }
      >
        {diffUnavailable && (
          <Alert
            type="warning"
            showIcon
            message="问真 fixtures 暂不可用"
            description="后端返回 503，请稍后再试或检查服务状态。"
            style={{ marginBottom: 16 }}
          />
        )}
        {diffError && (
          <Alert type="error" showIcon message="加载差异摘要失败" description={diffError} style={{ marginBottom: 16 }} />
        )}
        {diff && (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={8} md={4}>
                <Statistic title="全部" value={diff.totals.all} />
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Statistic title="可报告" value={diff.totals.reportable} />
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Statistic title="待处理" value={diff.totals.pending} />
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Statistic title="已匹配" value={diff.totals.matched} />
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Statistic title="已接受" value={diff.totals.accepted} />
              </Col>
              <Col xs={12} sm={8} md={4}>
                <Statistic title="不一致" value={diff.totals.mismatched} styles={{ content: { color: '#cf1322' } }} />
              </Col>
            </Row>
            <Divider titlePlacement="left" plain>
              断言覆盖
            </Divider>
            <Table
              pagination={false}
              size="small"
              dataSource={coverageRows}
              rowKey="category"
              columns={[
                { title: '类别', dataIndex: 'label', key: 'label' },
                { title: '数量', dataIndex: 'count', key: 'count', width: 120 },
              ]}
            />
            {diff.pendingSamples.length > 0 && (
              <>
                <Divider titlePlacement="left" plain>
                  待处理样例
                </Divider>
                <Table
                  pagination={false}
                  size="small"
                  dataSource={diff.pendingSamples}
                  rowKey={(record, index) => record.sampleId ?? `pending-${index}`}
                  columns={pendingColumns}
                />
              </>
            )}
          </Space>
        )}
      </Card>

      {/* ===== 2. Capture / compare form ===== */}
      <Card title="采集与对照">
        <Form layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="样例 ID" required>
                <Input
                  value={draft.sampleId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, sampleId: event.target.value }))}
                  placeholder="例如 wz-2024-0001"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="来源标识" required>
                <Input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="例如 iwzwh-pczb"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="采集时间">
                <Input
                  value={draft.capturedAt}
                  onChange={(event) => setDraft((prev) => ({ ...prev, capturedAt: event.target.value }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="出生地" required>
                <Select
                  showSearch
                  filterOption={false}
                  allowClear
                  loading={birthplaceSearching}
                  notFoundContent={birthplaceSearching ? '检索中…' : '无匹配'}
                  placeholder="输入省市区关键字检索"
                  options={birthplaceSelectOptions}
                  onSearch={setBirthplaceQuery}
                  onSelect={handleBirthplaceSelect}
                  onClear={() => {
                    setBirthplaceQuery('')
                    setBirthplaceOptions([])
                    setDraft((prev) => ({
                      ...prev,
                      placeCode: '',
                      placeLabel: '',
                      placeLongitude: undefined,
                      placeLatitude: undefined,
                      placeTimezone: '',
                      placeCoordinateStatus: '',
                      placeCoordinateSource: '',
                      placeCoordinateLicense: '',
                      placeDataVersion: '',
                    }))
                  }}
                  suffixIcon={<SearchOutlined />}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="来源 URL">
                <Input
                  value={draft.sourceUrl}
                  onChange={(event) => setDraft((prev) => ({ ...prev, sourceUrl: event.target.value }))}
                />
              </Form.Item>
            </Col>
          </Row>

          {draft.placeLabel && (
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="地点">{draft.placeLabel}</Descriptions.Item>
              <Descriptions.Item label="编码">{draft.placeCode}</Descriptions.Item>
              <Descriptions.Item label="时区">{draft.placeTimezone || '-'}</Descriptions.Item>
              <Descriptions.Item label="经度">{draft.placeLongitude ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="纬度">{draft.placeLatitude ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="坐标置信度">{draft.placeCoordinateStatus || '-'}</Descriptions.Item>
              <Descriptions.Item label="坐标来源">{draft.placeCoordinateSource || '-'}</Descriptions.Item>
              <Descriptions.Item label="授权协议">{draft.placeCoordinateLicense || '-'}</Descriptions.Item>
              <Descriptions.Item label="数据集版本">{draft.placeDataVersion || '-'}</Descriptions.Item>
            </Descriptions>
          )}

          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item label="出生日期" required>
                <Input
                  placeholder="YYYY-MM-DD"
                  value={draft.date}
                  onChange={(event) => setDraft((prev) => ({ ...prev, date: event.target.value }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="出生时间" required>
                <Input
                  placeholder="HH:mm"
                  value={draft.time}
                  onChange={(event) => setDraft((prev) => ({ ...prev, time: event.target.value }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="历法">
                <Select
                  value={draft.calendarSystem}
                  options={CALENDAR_OPTIONS}
                  onChange={(value) => setDraft((prev) => ({ ...prev, calendarSystem: value }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="农历闰月">
                <Switch
                  checked={draft.lunarLeapMonth}
                  disabled={draft.calendarSystem !== 'lunar'}
                  onChange={(checked) => setDraft((prev) => ({ ...prev, lunarLeapMonth: checked }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item label="性别">
                <Select
                  value={draft.gender}
                  options={GENDER_OPTIONS}
                  onChange={(value) => setDraft((prev) => ({ ...prev, gender: value }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="使用真太阳时">
                <Switch
                  checked={draft.useTrueSolarTime}
                  onChange={(checked) => setDraft((prev) => ({ ...prev, useTrueSolarTime: checked }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="夏令时策略">
                <Select
                  value={draft.dstPolicy}
                  options={DST_OPTIONS}
                  onChange={(value) => setDraft((prev) => ({ ...prev, dstPolicy: value }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="日界">
                <Select
                  value={draft.dayBoundary}
                  options={DAY_BOUNDARY_OPTIONS}
                  onChange={(value) => setDraft((prev) => ({ ...prev, dayBoundary: value }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item label="起运流派">
                <Select
                  value={draft.luckMethod}
                  options={LUCK_METHOD_OPTIONS}
                  onChange={(value) => setDraft((prev) => ({ ...prev, luckMethod: value }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={18}>
              <Form.Item
                label="四柱（年 月 日 时）"
                required
                help="按顺序输入四个干支，空格分隔，例如：壬申 戊申 己巳 庚午"
              >
                <Input
                  value={draft.pillars}
                  onChange={(event) => setDraft((prev) => ({ ...prev, pillars: event.target.value }))}
                  placeholder="壬申 戊申 己巳 庚午"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="扩展 expected JSON" help="不要包含 pillars 字段；四柱请使用上方专用输入。">
            <TextArea
              autoSize={{ minRows: 6, maxRows: 18 }}
              value={draft.expectedJson}
              onChange={(event) => setDraft((prev) => ({ ...prev, expectedJson: event.target.value }))}
            />
          </Form.Item>

          {/* ===== 3. Evidence upload ===== */}
          <Divider titlePlacement="left" plain>
            截图凭证
          </Divider>
          <Space orientation="vertical" size={8} style={{ width: '100%' }}>
            <Upload
              accept="image/png,image/jpeg,image/webp"
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                void handleEvidenceUpload(file)
                return false
              }}
            >
              <Button icon={<CloudUploadOutlined />} loading={evidenceUploading}>
                上传截图
              </Button>
            </Upload>
            {draft.evidenceRef && (
              <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="evidenceRef">{draft.evidenceRef}</Descriptions.Item>
                <Descriptions.Item label="SHA256">{evidenceMeta?.sha256 ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="类型">{evidenceMeta?.mimeType ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="大小">{evidenceMeta ? formatSize(evidenceMeta.size) : '-'}</Descriptions.Item>
              </Descriptions>
            )}
            {!draft.evidenceRef && <Text type="secondary">保存前必须上传截图凭证。</Text>}
          </Space>

          {/* ===== 4. Flow query template ===== */}
          <Divider titlePlacement="left" plain>
            流盘查询（可选）
          </Divider>
          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item label="流盘目标日期">
                <Input
                  placeholder="YYYY-MM-DD"
                  value={draft.flowTargetDate ?? ''}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, flowTargetDate: event.target.value || null }))
                  }
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="流盘目标时间">
                <Input
                  placeholder="HH:mm"
                  value={draft.flowTargetTime ?? ''}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, flowTargetTime: event.target.value || null }))
                  }
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12} style={{ display: 'flex', alignItems: 'end', paddingBottom: 24 }}>
              <Space>
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={flowLoading}
                  onClick={() => void handleFlowFill()}
                >
                  填充流盘模板
                </Button>
                {lastFlowSelection && (
                  <Tag color="blue">
                    已填充 {lastFlowSelection.year}/{String(lastFlowSelection.month).padStart(2, '0')}{' '}
                    {lastFlowSelection.date}
                  </Tag>
                )}
              </Space>
            </Col>
          </Row>

          <Divider />

          <Space>
            <Button type="primary" loading={comparing} onClick={() => void handleCompare()}>
              对比校验
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!draft.evidenceRef}
              onClick={() => void handleSave()}
            >
              保存 fixture
            </Button>
          </Space>
        </Form>
      </Card>

      {/* ===== Compare result + accept differences ===== */}
      {matched !== null && (
        <Card title={matched ? '对比结果：完全匹配' : `对比结果：${mismatches.length} 处差异`}>
          {matched ? (
            <Alert type="success" showIcon message="所有断言均通过，可直接保存为 verified。" />
          ) : (
            <Space orientation="vertical" size={16} style={{ width: '100%' }}>
              <Table
                pagination={false}
                size="small"
                dataSource={mismatches}
                rowKey="path"
                columns={mismatchColumns}
              />
              <Divider titlePlacement="left" plain>
                接受差异审核
              </Divider>
              <Alert
                type="info"
                showIcon
                message="逐条填写差异理由并选择分类后方可保存。“产品缺陷”不可作为接受分类，需先修复。"
                style={{ marginBottom: 12 }}
              />
              {mismatches.map((mismatch) => (
                <Card key={mismatch.path} size="small" title={mismatch.path}>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item label="差异理由" required>
                        <Input
                          value={acceptanceReasons[mismatch.path] ?? ''}
                          onChange={(event) =>
                            setAcceptanceReasons((prev) => ({ ...prev, [mismatch.path]: event.target.value }))
                          }
                          placeholder="说明为何该差异可以被接受"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="差异分类" required>
                        <Select
                          value={acceptanceClassifications[mismatch.path] || undefined}
                          placeholder="请选择分类"
                          options={CLASSIFICATION_SELECT_OPTIONS}
                          onChange={(value) =>
                            setAcceptanceClassifications((prev) => ({ ...prev, [mismatch.path]: value }))
                          }
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              ))}
            </Space>
          )}
        </Card>
      )}
    </Space>
  )
}
