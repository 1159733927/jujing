import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import {
  ApiRequestError,
  createRuleProfile,
  deleteRuleProfile,
  listActiveRuleProfileVersions,
  listRuleProfileVersions,
  listRuleProfiles,
  setRuleProfileState,
  submitRuleProfileRevision,
  type CreateRuleProfileInput,
  type RuleProfileListParams,
  type RuleProfileRevisionInput,
} from '../api'
import type {
  AssessmentName,
  DecisionRule,
  PublishedRuleProfileVersion,
  RuleProfile,
  RuleProfileDefinition,
  RuleProfileDraft,
  RuleProfileState,
  TrueSolarTimeRuleVersion,
} from '../types'
import {
  buildRuleProfileRevisionPayload,
  buildRuleProfileWorkingDefinition,
  defaultTrueSolarTimeRuleVersion,
  emptyRuleJson,
  emptyRuleProfileDraft,
  normalizeRuleProfileDefinition,
  parseDecisionRules,
  profileStateLabels,
  ruleJsonFromDefinition,
  ruleProfileDraftFromProfile,
  ruleProfileSaveErrorMessage,
  trueSolarTimeRuleVersionLabels,
} from '../lib/rule-profiles'

const { TextArea } = Input
const { Text } = Typography

const assessmentNames: AssessmentName[] = ['strength', 'pattern', 'shenSha']
const assessmentLabels: Record<AssessmentName, string> = { strength: '日主强弱', pattern: '格局', shenSha: '神煞' }

const stateColors: Record<RuleProfileState, string> = {
  draft: 'default',
  'in-review': 'gold',
  published: 'green',
  archived: 'gray',
}

type EditorMode = 'create' | 'edit'

type EditorFormValues = {
  name: string
  description: string
  key: string
  timezone: string
  dstPolicy: 'auto' | 'ignore'
  useTrueSolarTime: boolean
  timeCorrectionRuleVersion: TrueSolarTimeRuleVersion
  dayBoundary: 'midnight' | 'zi-hour-start'
  luckMethod: 'sect1' | 'sect2'
  strengthEnabled: boolean
  strengthMethod: string
  strengthRuleSetVersion: string
  strengthRulesJson: string
  patternEnabled: boolean
  patternMethod: string
  patternRuleSetVersion: string
  patternRulesJson: string
  shenShaEnabled: boolean
  shenShaMethod: string
  shenShaRuleSetVersion: string
  shenShaRulesJson: string
}

function draftToFormValues(draft: RuleProfileDraft): EditorFormValues {
  const def = normalizeRuleProfileDefinition(draft.definition)
  const jsonMap = ruleJsonFromDefinition(def)
  return {
    name: draft.name,
    description: draft.description,
    key: draft.key,
    timezone: def.timeDefaults.timezone,
    dstPolicy: def.timeDefaults.dstPolicy,
    useTrueSolarTime: def.timeDefaults.useTrueSolarTime,
    timeCorrectionRuleVersion: def.timeDefaults.timeCorrectionRuleVersion,
    dayBoundary: def.timeDefaults.dayBoundary,
    luckMethod: def.timeDefaults.luckMethod,
    strengthEnabled: def.assessments.strength.enabled,
    strengthMethod: def.assessments.strength.method,
    strengthRuleSetVersion: def.assessments.strength.ruleSetVersion,
    strengthRulesJson: jsonMap.strength,
    patternEnabled: def.assessments.pattern.enabled,
    patternMethod: def.assessments.pattern.method,
    patternRuleSetVersion: def.assessments.pattern.ruleSetVersion,
    patternRulesJson: jsonMap.pattern,
    shenShaEnabled: def.assessments.shenSha.enabled,
    shenShaMethod: def.assessments.shenSha.method,
    shenShaRuleSetVersion: def.assessments.shenSha.ruleSetVersion,
    shenShaRulesJson: jsonMap.shenSha,
  }
}

function formValuesToBaseDefinition(values: EditorFormValues): RuleProfileDefinition {
  return {
    schemaVersion: 2,
    timeDefaults: {
      timezone: values.timezone.trim(),
      dstPolicy: values.dstPolicy,
      useTrueSolarTime: values.useTrueSolarTime,
      timeCorrectionRuleVersion: values.timeCorrectionRuleVersion,
      dayBoundary: values.dayBoundary,
      luckMethod: values.luckMethod,
    },
    assessments: {
      strength: { enabled: values.strengthEnabled, method: values.strengthMethod.trim(), ruleSetVersion: values.strengthRuleSetVersion.trim(), rules: [] },
      pattern: { enabled: values.patternEnabled, method: values.patternMethod.trim(), ruleSetVersion: values.patternRuleSetVersion.trim(), rules: [] },
      shenSha: { enabled: values.shenShaEnabled, method: values.shenShaMethod.trim(), ruleSetVersion: values.shenShaRuleSetVersion.trim(), rules: [] },
    },
  }
}

export default function RuleProfilesPage() {
  const { message, modal, notification } = App.useApp()

  // ---- list state ----
  const [loading, setLoading] = useState(false)
  const [profiles, setProfiles] = useState<RuleProfile[]>([])
  const [searchQ, setSearchQ] = useState('')
  const [stateFilter, setStateFilter] = useState<RuleProfileState | 'all'>('all')
  const [publishedVersionIds, setPublishedVersionIds] = useState<Set<string>>(new Set())

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: RuleProfileListParams = {}
      if (searchQ.trim()) params.q = searchQ.trim()
      if (stateFilter !== 'all') params.state = stateFilter
      const [list, activeVersions] = await Promise.all([
        listRuleProfiles(params),
        listActiveRuleProfileVersions(),
      ])
      setProfiles(list)
      setPublishedVersionIds(new Set(activeVersions.map((v) => v.versionId)))
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '加载流派规则失败')
    } finally {
      setLoading(false)
    }
  }, [message, searchQ, stateFilter])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // ---- editor drawer state ----
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('create')
  const [editingProfile, setEditingProfile] = useState<RuleProfile | null>(null)
  const [draft, setDraft] = useState<RuleProfileDraft>(emptyRuleProfileDraft())
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<EditorFormValues>()

  function openCreate() {
    const newDraft = emptyRuleProfileDraft()
    setEditorMode('create')
    setEditingProfile(null)
    setDraft(newDraft)
    form.setFieldsValue(draftToFormValues(newDraft))
    setDrawerOpen(true)
  }

  function openEdit(profile: RuleProfile) {
    const loaded = ruleProfileDraftFromProfile(profile)
    setEditorMode('edit')
    setEditingProfile(profile)
    setDraft(loaded)
    form.setFieldsValue(draftToFormValues(loaded))
    setDrawerOpen(true)
  }

  async function handleSave() {
    let values: EditorFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const ids = publishedVersionIds
    let parsedStrength: DecisionRule[]
    let parsedPattern: DecisionRule[]
    let parsedShenSha: DecisionRule[]
    try {
      parsedStrength = parseDecisionRules('日主强弱', values.strengthRulesJson, values.strengthEnabled, ids)
      parsedPattern = parseDecisionRules('格局', values.patternRulesJson, values.patternEnabled, ids)
      parsedShenSha = parseDecisionRules('神煞', values.shenShaRulesJson, values.shenShaEnabled, ids)
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '规则解析失败')
      return
    }

    const baseDef = formValuesToBaseDefinition(values)
    const workingDefinition = buildRuleProfileWorkingDefinition(baseDef, {
      strength: parsedStrength,
      pattern: parsedPattern,
      shenSha: parsedShenSha,
    })

    const updatedDraft: RuleProfileDraft = {
      ...draft,
      key: values.key.trim(),
      name: values.name.trim(),
      description: values.description.trim(),
      definition: workingDefinition,
    }

    setSaving(true)
    try {
      if (editorMode === 'create') {
        const payload: CreateRuleProfileInput = {
          key: updatedDraft.key,
          name: updatedDraft.name,
          ...(updatedDraft.description ? { description: updatedDraft.description } : {}),
          workingDefinition,
        }
        await createRuleProfile(payload)
        message.success('流派规则已创建')
      } else {
        if (!editingProfile) throw new Error('缺少编辑目标')
        const revisionPayload: RuleProfileRevisionInput = buildRuleProfileRevisionPayload(updatedDraft, workingDefinition)
        await submitRuleProfileRevision(editingProfile.id, revisionPayload)
        message.success('流派规则已保存')
      }
      setDrawerOpen(false)
      void fetchList()
    } catch (cause) {
      message.error(ruleProfileSaveErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  // ---- publish ----
  function confirmPublish(profile: RuleProfile) {
    modal.confirm({
      title: '确认发布',
      content: `确定将「${profile.name}」从草稿直接发布为正式版本吗？发布后该版本不可变。`,
      okText: '发布',
      cancelText: '取消',
      onOk: async () => {
        try {
          await setRuleProfileState(profile.id, 'published')
          const versions = await listRuleProfileVersions(profile.id)
          const latest = versions[0]
          if (latest) {
            notification.success({
              title: '发布成功',
              description: `版本 ${latest.version} · hash ${latest.contentHash.slice(0, 12)}…`,
            })
          } else {
            message.success('已发布')
          }
          void fetchList()
        } catch (cause) {
          message.error(cause instanceof Error ? cause.message : '发布失败')
        }
      },
    })
  }

  // ---- archive ----
  function confirmArchive(profile: RuleProfile) {
    modal.confirm({
      title: '确认归档',
      content: `确定将「${profile.name}」归档吗？归档后不再作为生效版本。`,
      okText: '归档',
      cancelText: '取消',
      onOk: async () => {
        try {
          await setRuleProfileState(profile.id, 'archived')
          message.success('已归档')
          void fetchList()
        } catch (cause) {
          message.error(cause instanceof Error ? cause.message : '归档失败')
        }
      },
    })
  }

  // ---- delete ----
  function confirmDelete(profile: RuleProfile) {
    if (profile.state === 'draft') {
      modal.confirm({
        title: '确认删除',
        content: `确定删除草稿「${profile.name}」吗？此操作不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => executeDelete(profile.id, profile.name),
      })
      return
    }

    // published / archived → typed-name confirmation
    let inputValue = ''
    const targetName = profile.name
    const m = modal.confirm({
      title: '确认删除',
      content: (
        <div>
          <p>请输入流派名称以确认删除：</p>
          <Input
            placeholder={targetName}
            onChange={(e) => {
              inputValue = e.target.value
              m.update({ okButtonProps: { danger: true, disabled: inputValue !== targetName } })
            }}
          />
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true, disabled: true },
      cancelText: '取消',
      afterOpenChange: (open) => {
        if (!open) inputValue = ''
      },
      onOk: async () => {
        if (inputValue !== targetName) {
          message.warning('输入的名称不匹配，已取消删除')
          return Promise.reject(new Error('name-mismatch'))
        }
        await executeDelete(profile.id, profile.name)
      },
    })
  }

  async function executeDelete(id: string, name: string) {
    try {
      await deleteRuleProfile(id)
      message.success(`「${name}」已删除`)
      setProfiles((prev) => prev.filter((p) => p.id !== id))
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        message.error(cause.message || '该流派规则已被命盘引用，无法删除')
      } else {
        message.error(cause instanceof Error ? cause.message : '删除失败')
      }
    }
  }

  // ---- version history ----
  function showVersionHistory(profile: RuleProfile) {
    let versions: PublishedRuleProfileVersion[] = []
    const historyModal = modal.info({
      title: `版本历史 · ${profile.name}`,
      width: 720,
      content: '加载中…',
      okText: '关闭',
    })

    void listRuleProfileVersions(profile.id).then((list) => {
      versions = list
      historyModal.update({
        content: (
          <Table<PublishedRuleProfileVersion>
            dataSource={versions}
            rowKey="versionId"
            size="small"
            pagination={false}
            scroll={{ y: 360 }}
            columns={[
              { title: '版本', dataIndex: 'version', width: 72 },
              { title: 'versionId', dataIndex: 'versionId', ellipsis: true },
              { title: 'contentHash', dataIndex: 'contentHash', width: 140, render: (h: string) => <Text copyable={{ text: h }}>{h.slice(0, 16)}…</Text> },
              { title: '发布时间', dataIndex: 'publishedAt', width: 170, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
              { title: '发布人', dataIndex: 'publishedBy', width: 120 },
            ]}
          />
        ),
      })
    }).catch((cause) => {
      historyModal.update({ content: <Text type="danger">{cause instanceof Error ? cause.message : '加载版本历史失败'}</Text> })
    })
  }

  // ---- table columns ----
  const columns = useMemo<ColumnsType<RuleProfile>>(() => [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'key', dataIndex: 'key', key: 'key', width: 160, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 100,
      render: (state: RuleProfileState) => <Tag color={stateColors[state]}>{profileStateLabels[state] ?? state}</Tag>,
    },
    { title: '修订', dataIndex: 'revision', key: 'revision', width: 72 },
    {
      title: '生效版本',
      dataIndex: 'currentPublishedVersionId',
      key: 'currentPublishedVersionId',
      width: 160,
      render: (v?: string) => v ? <Text copyable={{ text: v }}>{v.slice(0, 12)}…</Text> : '—',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: unknown, record: RuleProfile) => (
        <Space size={4} wrap>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          {record.state === 'draft' && (
            <Button type="link" size="small" icon={<SendOutlined />} onClick={() => confirmPublish(record)}>发布</Button>
          )}
          {record.state === 'published' && (
            <Button type="link" size="small" icon={<StopOutlined />} onClick={() => confirmArchive(record)}>归档</Button>
          )}
          <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => showVersionHistory(record)}>版本历史</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(record)}>删除</Button>
        </Space>
      ),
    },
  ], [])

  // ---- render ----
  return (
    <>
      <Card
        title="八字流派规则配置"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void fetchList()} loading={loading}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建规则</Button>
          </Space>
        }
      >
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col flex="auto">
            <Input.Search
              allowClear
              placeholder="按名称搜索"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onSearch={() => void fetchList()}
            />
          </Col>
          <Col flex="160px">
            <Select
              style={{ width: '100%' }}
              value={stateFilter}
              onChange={(v) => setStateFilter(v)}
              options={[
                { label: '全部状态', value: 'all' },
                { label: '草稿', value: 'draft' },
                { label: '待审核', value: 'in-review' },
                { label: '已发布', value: 'published' },
                { label: '已归档', value: 'archived' },
              ]}
            />
          </Col>
        </Row>

        <Table<RuleProfile>
          rowKey="id"
          loading={loading}
          dataSource={profiles}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          size="middle"
        />
      </Card>

      {/* Editor Drawer */}
      <Drawer
        title={editorMode === 'create' ? '新建流派规则' : `编辑 · ${editingProfile?.name ?? ''}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={720}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：子平真诠·标准版" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <TextArea rows={2} placeholder="可选描述" />
          </Form.Item>
          <Form.Item
            label="key"
            name="key"
            rules={[{ required: true, message: '请输入唯一 key' }, { pattern: /^[a-z][a-z0-9._-]*$/, message: '仅允许小写字母、数字、点、下划线、连字符，且以字母开头' }]}
            extra={editorMode === 'edit' ? 'key 创建后不可修改' : undefined}
          >
            <Input placeholder="例如：ziping-standard" disabled={editorMode === 'edit'} />
          </Form.Item>

          <Typography.Title level={5} style={{ marginTop: 24 }}>时间默认值</Typography.Title>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="时区" name="timezone" rules={[{ required: true, message: '请输入时区' }]}>
                <Input placeholder="Asia/Shanghai" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="夏令时策略" name="dstPolicy" rules={[{ required: true }]}>
                <Select options={[{ label: 'auto', value: 'auto' }, { label: 'ignore', value: 'ignore' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="使用真太阳时" name="useTrueSolarTime" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="真太阳时校正版本" name="timeCorrectionRuleVersion" rules={[{ required: true }]}>
                <Select
                  options={Object.entries(trueSolarTimeRuleVersionLabels).map(([value, label]) => ({ label, value }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="日界" name="dayBoundary" rules={[{ required: true }]}>
                <Select options={[{ label: 'midnight（午夜）', value: 'midnight' }, { label: 'zi-hour-start（子时起）', value: 'zi-hour-start' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="大运排法" name="luckMethod" rules={[{ required: true }]}>
                <Select options={[{ label: 'sect1', value: 'sect1' }, { label: 'sect2', value: 'sect2' }]} />
              </Form.Item>
            </Col>
          </Row>

          {assessmentNames.map((name) => {
            const enabledField = `${name}Enabled` as const
            const methodField = `${name}Method` as const
            const ruleSetVersionField = `${name}RuleSetVersion` as const
            const rulesJsonField = `${name}RulesJson` as const
            return (
              <div key={name} style={{ marginTop: 24 }}>
                <Typography.Title level={5}>{assessmentLabels[name]}</Typography.Title>
                <Row gutter={16}>
                  <Col span={6}>
                    <Form.Item label="启用" name={enabledField} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col span={9}>
                    <Form.Item label="method" name={methodField} rules={[{ required: true, message: '请输入 method' }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={9}>
                    <Form.Item label="ruleSetVersion" name={ruleSetVersionField} rules={[{ required: true, message: '请输入版本号' }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  label={`${assessmentLabels[name]}规则 JSON`}
                  name={rulesJsonField}
                  extra="规则只能引用固定事实路径、固定操作符、已发布知识版本，不可执行脚本"
                  rules={[{ required: true, message: '请输入规则 JSON' }]}
                >
                  <TextArea rows={8} placeholder="[]" style={{ fontFamily: 'monospace', fontSize: 12 }} />
                </Form.Item>
              </div>
            )
          })}
        </Form>
      </Drawer>
    </>
  )
}
