import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CloudUploadOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Asset, AssetKind, AssetState, PublishedKnowledgeVersionOption } from '../types'
import {
  ApiRequestError,
  createKnowledge,
  deleteKnowledge,
  listKnowledge,
  listKnowledgeVersions,
  setKnowledgeState,
  submitKnowledgeRevision,
} from '../api'
import type { CreateKnowledgeInput, KnowledgeListParams } from '../api'
import {
  buildKnowledgeOverviewCards,
  buildKnowledgeRevisionPayload,
  fileTitle,
  formatFileSize,
  isKnowledgeAssetRevisable,
  kindLabels,
  knowledgeRevisionDraftFromAsset,
  knowledgeRevisionErrorMessage,
  parseTags,
  stateLabels,
} from '../lib/knowledge'

const ALL_KINDS: Array<{ label: string; value: AssetKind | 'all' }> = [
  { label: '全部类型', value: 'all' },
  { label: kindLabels.article, value: 'article' },
  { label: kindLabels.rule, value: 'rule' },
  { label: kindLabels.skill, value: 'skill' },
]

const ALL_STATES: Array<{ label: string; value: AssetState | 'all' }> = [
  { label: '全部状态', value: 'all' },
  { label: stateLabels.draft, value: 'draft' },
  { label: stateLabels['in-review'], value: 'in-review' },
  { label: stateLabels.published, value: 'published' },
  { label: stateLabels.archived, value: 'archived' },
]

const STATE_COLORS: Record<AssetState, string> = {
  draft: 'default',
  'in-review': 'gold',
  published: 'green',
  archived: 'default',
}

const KIND_COLORS: Record<AssetKind, string> = {
  article: 'blue',
  rule: 'purple',
  skill: 'cyan',
}

export default function KnowledgePage() {
  const { message, modal, notification } = App.useApp()

  // ---------- list state ----------
  const [loading, setLoading] = useState(false)
  const [assets, setAssets] = useState<Asset[]>([])
  const [params, setParams] = useState<KnowledgeListParams>({})
  const [searchDraft, setSearchDraft] = useState('')

  const fetchList = useCallback(async (p: KnowledgeListParams = params) => {
    setLoading(true)
    try {
      const rows = await listKnowledge(p)
      setAssets(rows)
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '加载资料列表失败')
    } finally {
      setLoading(false)
    }
  }, [message, params])

  useEffect(() => {
    void fetchList(params)
  }, [fetchList, params])

  // ---------- drawer state ----------
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [importInfo, setImportInfo] = useState<string | null>(null)

  // ---------- version history state ----------
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRows, setHistoryRows] = useState<PublishedKnowledgeVersionOption[]>([])
  const [historyTitle, setHistoryTitle] = useState('')

  // ---------- summary cards ----------
  const overviewCards = useMemo(() => buildKnowledgeOverviewCards(assets), [assets])

  // ---------- handlers ----------
  function handleSearch(value: string) {
    const next: KnowledgeListParams = { ...params, q: value || undefined }
    setParams(next)
  }

  function openCreate(kind: AssetKind = 'article') {
    setEditingAsset(null)
    setImportInfo(null)
    form.resetFields()
    form.setFieldsValue({ kind, tagsText: '', body: '' })
    setDrawerOpen(true)
  }

  function openEdit(asset: Asset) {
    if (!isKnowledgeAssetRevisable(asset)) return
    setEditingAsset(asset)
    setImportInfo(null)
    const draft = knowledgeRevisionDraftFromAsset(asset)
    form.setFieldsValue({
      kind: draft.kind,
      title: draft.title,
      sourceLabel: draft.sourceLabel,
      tagsText: draft.tagsText,
      body: draft.body,
      ruleJson: draft.rule ? JSON.stringify(draft.rule, null, 2) : '',
    })
    setDrawerOpen(true)
  }

  async function handleSave() {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const kind = values.kind as AssetKind
    const title = (values.title as string)?.trim() ?? ''
    const sourceLabel = (values.sourceLabel as string)?.trim() ?? ''
    const tagsText = (values.tagsText as string) ?? ''
    const body = (values.body as string)?.trim() ?? ''
    const tags = parseTags(tagsText)

    if (!title) { message.error('标题不能为空。'); return }
    if (!sourceLabel) { message.error('来源不能为空。'); return }
    if (!body) { message.error('正文不能为空。'); return }

    let ruleForSubmit: Asset['rule'] | undefined
    if (kind === 'rule') {
      if (editingAsset?.rule) {
        // editing existing rule: carry through unchanged
        ruleForSubmit = structuredClone(editingAsset.rule)
      } else {
        // new rule asset: parse JSON defensively
        const raw = (values.ruleJson as string)?.trim() ?? ''
        if (!raw) { message.error('结构化规则 JSON 不能为空。'); return }
        try {
          ruleForSubmit = JSON.parse(raw) as Asset['rule']
        } catch {
          message.error('结构化规则 JSON 格式无效，请检查后重试。')
          return
        }
      }
    }

    setSaving(true)
    try {
      if (editingAsset) {
        const draft = knowledgeRevisionDraftFromAsset(editingAsset)
        // override with form values
        draft.kind = kind
        draft.title = title
        draft.sourceLabel = sourceLabel
        draft.tagsText = tagsText
        draft.body = body
        if (ruleForSubmit) draft.rule = ruleForSubmit
        const payload = buildKnowledgeRevisionPayload(draft)
        await submitKnowledgeRevision(editingAsset.id, payload)
        message.success('新修订已保存')
      } else {
        const input: CreateKnowledgeInput = { kind, title, sourceLabel, tags, body }
        if (kind === 'rule' && ruleForSubmit) input.rule = ruleForSubmit
        await createKnowledge(input)
        message.success('资料已创建')
      }
      setDrawerOpen(false)
      await fetchList()
    } catch (cause) {
      message.error(knowledgeRevisionErrorMessage(cause))
      // keep drawer open preserving form state
    } finally {
      setSaving(false)
    }
  }

  // ---------- publish ----------
  function handlePublish(asset: Asset) {
    if (asset.state !== 'draft') return
    const nextVersion = asset.version
    modal.confirm({
      title: '确认发布',
      content: `将发布为 v${nextVersion}（内容哈希由服务端固化）`,
      okText: '确认发布',
      cancelText: '取消',
      onOk: async () => {
        try {
          await setKnowledgeState(asset.id, 'published')
          // re-fetch versions to get hash
          const versions = await listKnowledgeVersions(asset.id)
          const newest = versions.sort((a, b) => b.version - a.version)[0]
          const hashSnippet = newest?.contentHash ? newest.contentHash.slice(0, 16) : '—'
          notification.success({
            title: '发布成功',
            description: `版本 v${newest?.version ?? nextVersion}，内容哈希 ${hashSnippet}`,
          })
          await fetchList()
        } catch (cause) {
          message.error(cause instanceof Error ? cause.message : '发布失败')
        }
      },
    })
  }

  // ---------- archive ----------
  async function handleArchive(asset: Asset) {
    if (asset.state !== 'published') return
    try {
      await setKnowledgeState(asset.id, 'archived')
      message.success('已归档')
      await fetchList()
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '归档失败')
    }
  }

  // ---------- version history ----------
  async function openHistory(asset: Asset) {
    setHistoryTitle(asset.title)
    setHistoryRows([])
    setHistoryOpen(true)
    setHistoryLoading(true)
    try {
      const rows = await listKnowledgeVersions(asset.id)
      setHistoryRows(rows.sort((a, b) => b.version - a.version))
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '加载版本历史失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  // ---------- delete ----------
  function handleDelete(asset: Asset) {
    if (asset.state === 'draft') {
      modal.confirm({
        title: '确认删除草稿',
        content: `确定要删除「${asset.title}」吗？此操作不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => doDelete(asset),
      })
      return
    }
    // published/archived: strong confirm — type exact title
    let typedValue = ''
    const m = modal.confirm({
      title: '确认删除',
      content: (
        <div>
          <Typography.Paragraph>
            此资料状态为「{stateLabels[asset.state]}」，删除前请输入资料标题以确认：
          </Typography.Paragraph>
          <Typography.Paragraph code copyable>{asset.title}</Typography.Paragraph>
          <Input
            placeholder="请输入上方标题"
            onChange={(e) => {
              typedValue = e.target.value
              m.update({ okButtonProps: { danger: true, disabled: typedValue !== asset.title } })
            }}
          />
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true, disabled: true },
      cancelText: '取消',
      onOk: () => doDelete(asset),
    })
  }

  async function doDelete(asset: Asset) {
    try {
      await deleteKnowledge(asset.id)
      message.success('已删除')
      setAssets((prev) => prev.filter((a) => a.id !== asset.id))
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        message.error(cause.message)
        // KEEP the row
        return
      }
      message.error(cause instanceof Error ? cause.message : '删除失败')
    }
  }

  // ---------- file import ----------
  function handleFileImport(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      form.setFieldsValue({ body: text })
      const currentTitle = form.getFieldValue('title') as string | undefined
      if (!currentTitle?.trim()) {
        form.setFieldsValue({ title: fileTitle(file.name) })
      }
      setImportInfo(`已导入 ${file.name}（${formatFileSize(file.size)}）`)
    }
    reader.onerror = () => {
      message.error('读取文件失败')
    }
    reader.readAsText(file)
    return false // prevent auto-upload
  }

  // ---------- columns ----------
  const columns: ColumnsType<Asset> = useMemo(() => [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      width: 260,
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 120,
      render: (kind: AssetKind) => <Tag color={KIND_COLORS[kind]}>{kindLabels[kind]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 100,
      render: (state: AssetState) => <Tag color={STATE_COLORS[state]}>{stateLabels[state]}</Tag>,
    },
    {
      title: '当前版本',
      dataIndex: 'version',
      key: 'version',
      width: 90,
      render: (v: number) => `v${v}`,
    },
    {
      title: '更新人',
      key: 'updatedBy',
      width: 110,
      render: (_: unknown, record: Asset) => record.updatedBy ?? record.createdBy ?? '—',
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: 170,
      render: (_: unknown, record: Asset) =>
        record.updatedAt ? dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm') : '—',
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      fixed: 'right',
      render: (_: unknown, record: Asset) => {
        const canEdit = isKnowledgeAssetRevisable(record)
        const canPublish = record.state === 'draft'
        const canArchive = record.state === 'published'
        return (
          <Space size={4} wrap>
            {canEdit && (
              <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
            )}
            {canPublish && (
              <Button type="link" size="small" onClick={() => handlePublish(record)}>发布</Button>
            )}
            {canArchive && (
              <Button type="link" size="small" onClick={() => handleArchive(record)}>归档</Button>
            )}
            <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => openHistory(record)}>
              版本历史
            </Button>
            <Button type="link" size="small" danger onClick={() => handleDelete(record)}>删除</Button>
          </Space>
        )
      },
    },
  ], [])

  // ---------- version history columns ----------
  const historyColumns: ColumnsType<PublishedKnowledgeVersionOption> = [
    { title: '版本', dataIndex: 'version', key: 'version', width: 80, render: (v: number) => `v${v}` },
    { title: 'versionId', dataIndex: 'versionId', key: 'versionId', ellipsis: true },
    {
      title: '内容哈希',
      dataIndex: 'contentHash',
      key: 'contentHash',
      ellipsis: true,
      render: (h?: string) => h ? <Typography.Text code copyable={{ text: h }}>{h}</Typography.Text> : '—',
    },
    {
      title: '发布时间',
      dataIndex: 'publishedAt',
      key: 'publishedAt',
      width: 170,
      render: (v?: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
    { title: '发布人', dataIndex: 'publishedBy', key: 'publishedBy', width: 120, render: (v?: string) => v ?? '—' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary cards */}
      <Row gutter={[16, 16]}>
        {overviewCards.map((card) => (
          <Col xs={24} sm={12} md={6} key={card.label}>
            <Card size="small">
              <Statistic
                title={card.label}
                value={card.value}
                styles={{ content: { color: card.state === 'ready' ? '#52c41a' : card.state === 'pending' ? '#faad14' : undefined } }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{card.detail}</Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Toolbar */}
      <Card size="small">
        <Space wrap>
          <Input.Search
            placeholder="搜索标题关键词"
            allowClear
            defaultValue={params.q}
            onSearch={handleSearch}
            onChange={(e) => setSearchDraft(e.target.value)}
            onPressEnter={() => handleSearch(searchDraft)}
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
          />
          <Select
            value={params.kind ?? 'all'}
            options={ALL_KINDS}
            onChange={(v) => setParams((p) => ({ ...p, kind: v === 'all' ? undefined : v }))}
            style={{ width: 140 }}
          />
          <Select
            value={params.state ?? 'all'}
            options={ALL_STATES}
            onChange={(v) => setParams((p) => ({ ...p, state: v === 'all' ? undefined : v }))}
            style={{ width: 120 }}
          />
          <Button icon={<PlusOutlined />} type="primary" onClick={() => openCreate()}>新建资料</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchList()}>刷新</Button>
        </Space>
      </Card>

      {/* Table */}
      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<Asset>
          rowKey="id"
          columns={columns}
          dataSource={assets}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          locale={{ emptyText: <Empty description="暂无资料" /> }}
        />
      </Card>

      {/* Create / Edit Drawer */}
      <Drawer
        title={editingAsset ? `编辑「${editingAsset.title}」` : '新建资料'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={640}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          {!editingAsset && (
            <Form.Item label="类型" name="kind" rules={[{ required: true }]}>
              <Select options={ALL_KINDS.filter((o) => o.value !== 'all')} />
            </Form.Item>
          )}
          {editingAsset && (
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="类型">{kindLabels[editingAsset.kind]}</Descriptions.Item>
              <Descriptions.Item label="当前版本">v{editingAsset.version}</Descriptions.Item>
              <Descriptions.Item label="状态">{stateLabels[editingAsset.state]}</Descriptions.Item>
            </Descriptions>
          )}
          <Form.Item label="标题" name="title" rules={[{ required: true, max: 200 }]}>
            <Input placeholder="资料标题" maxLength={200} />
          </Form.Item>
          <Form.Item label="来源" name="sourceLabel" rules={[{ required: true, max: 200 }]}>
            <Input placeholder="来源标注" maxLength={200} />
          </Form.Item>
          <Form.Item label="标签" name="tagsText">
            <Input placeholder="多个标签用逗号分隔" />
          </Form.Item>
          <Form.Item label="正文" name="body" rules={[{ required: true }]}>
            <Input.TextArea rows={14} placeholder="资料正文" />
          </Form.Item>
          <Form.Item label="导入文件">
            <Upload
              accept=".txt,.md,.json"
              beforeUpload={handleFileImport}
              showUploadList={false}
              maxCount={1}
            >
              <Button icon={<CloudUploadOutlined />}>选择 .txt / .md / .json</Button>
            </Upload>
            {importInfo && (
              <Typography.Text type="success" style={{ marginLeft: 8 }}>{importInfo}</Typography.Text>
            )}
          </Form.Item>
          {!editingAsset && (
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.kind !== cur.kind}>
              {({ getFieldValue }) =>
                getFieldValue('kind') === 'rule' ? (
                  <Form.Item label="结构化规则 JSON" name="ruleJson" rules={[{ required: true }]}>
                    <Input.TextArea rows={8} placeholder='{"priority":1,"conditions":[...],"conclusions":[...]}' />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          )}
        </Form>
      </Drawer>

      {/* Version History Drawer */}
      <Drawer
        title={`版本历史 — ${historyTitle}`}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size={720}
        destroyOnHidden
      >
        <Table<PublishedKnowledgeVersionOption>
          rowKey="versionId"
          columns={historyColumns}
          dataSource={historyRows}
          loading={historyLoading}
          pagination={false}
          size="small"
          locale={{ emptyText: <Empty description="暂无已发布版本" /> }}
        />
      </Drawer>
    </div>
  )
}
