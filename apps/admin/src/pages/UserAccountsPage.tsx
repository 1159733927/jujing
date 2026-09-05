import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { EyeOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  createUserAccount,
  getUserAccountOverview,
  listUserAccounts,
  resetUserAccountPassword,
  setUserAccountStatus,
} from '../api'
import type { AdminReportSummary, UserAccount, UserAccountOverview } from '../types'

type AccountForm = { username: string; displayName: string; password: string }
type PasswordForm = { password: string }

export function userStatusLabel(status: UserAccount['status']): string {
  return status === 'active' ? '正常' : '已停用'
}

const relationshipLabel: Record<string, string> = {
  self: '本人',
  partner: '伴侣',
  parent: '父母',
  child: '子女',
  other: '其他',
}

function reportStatusLabel(report: AdminReportSummary): string {
  if (report.archivedAt) return '回收站'
  if (report.status === 'completed') return report.hasReport ? '已完成' : '需重算'
  if (report.status === 'failed') return '生成失败'
  return '生成中'
}

export default function UserAccountsPage() {
  const { message } = App.useApp()
  const [accounts, setAccounts] = useState<UserAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null)
  const [overviewTarget, setOverviewTarget] = useState<UserAccount | null>(null)
  const [overview, setOverview] = useState<UserAccountOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createForm] = Form.useForm<AccountForm>()
  const [passwordForm] = Form.useForm<PasswordForm>()

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      setAccounts(await listUserAccounts())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账号列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  async function handleCreate(values: AccountForm) {
    setSubmitting(true)
    try {
      await createUserAccount({
        username: values.username.trim(),
        displayName: values.displayName.trim(),
        password: values.password,
      })
      setCreateOpen(false)
      createForm.resetFields()
      message.success('账号已创建')
      await loadAccounts()
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatus(account: UserAccount) {
    const status = account.status === 'active' ? 'disabled' : 'active'
    try {
      await setUserAccountStatus(account.id, status)
      message.success(status === 'active' ? '账号已启用' : '账号已停用')
      await loadAccounts()
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '状态更新失败')
    }
  }

  async function handleResetPassword(values: PasswordForm) {
    if (!resetTarget) return
    setSubmitting(true)
    try {
      await resetUserAccountPassword(resetTarget.id, values.password)
      setResetTarget(null)
      passwordForm.resetFields()
      message.success('密码已重置，原登录会话将失效')
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '密码重置失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function openOverview(account: UserAccount) {
    setOverviewTarget(account)
    setOverview(null)
    setOverviewError('')
    setOverviewLoading(true)
    try {
      setOverview(await getUserAccountOverview(account.id))
    } catch (cause) {
      setOverviewError(cause instanceof Error ? cause.message : '账号详情加载失败')
    } finally {
      setOverviewLoading(false)
    }
  }

  return (
    <Space orientation="vertical" size={20} style={{ width: '100%' }}>
      <Row justify="space-between" align="middle">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>用户账号</Typography.Title>
          <Typography.Text type="secondary">由管理员下发 C 端账号；停用后用户不能继续登录。</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadAccounts()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建账号</Button>
        </Space>
      </Row>

      {error && <Alert type="error" showIcon message="账号列表加载失败" description={error} />}

      <Card styles={{ body: { padding: 0 } }}>
        <Table<UserAccount>
          rowKey="id"
          loading={loading}
          dataSource={accounts}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: '暂无用户账号' }}
          columns={[
            { title: '用户名', dataIndex: 'username', render: (value) => <Typography.Text strong>{value}</Typography.Text> },
            { title: '显示名', dataIndex: 'displayName' },
            {
              title: '状态', dataIndex: 'status', width: 100,
              render: (status: UserAccount['status']) => <Tag color={status === 'active' ? 'green' : 'default'}>{userStatusLabel(status)}</Tag>,
            },
            { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm') },
            { title: '最近登录', dataIndex: 'lastLoginAt', width: 180, render: (value?: string) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '尚未登录' },
            {
              title: '操作', key: 'actions', width: 230,
              render: (_, account) => (
                <Space>
                  <Button type="link" icon={<EyeOutlined />} onClick={() => void openOverview(account)}>查看详情</Button>
                  <Button type="link" icon={<KeyOutlined />} onClick={() => setResetTarget(account)}>重置密码</Button>
                  <Popconfirm
                    title={account.status === 'active' ? '停用这个账号？' : '重新启用这个账号？'}
                    description={account.status === 'active' ? '停用后该用户的登录会话会失效。' : undefined}
                    okText="确认"
                    cancelText="取消"
                    onConfirm={() => handleStatus(account)}
                  >
                    <Button type="link" danger={account.status === 'active'}>{account.status === 'active' ? '停用' : '启用'}</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="创建用户账号"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => createForm.submit()}
        onCancel={() => { setCreateOpen(false); createForm.resetFields() }}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate} requiredMark={false}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }, { min: 3, message: '至少 3 个字符' }]}>
            <Input autoComplete="off" placeholder="用户登录时使用" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]}>
            <Input autoComplete="off" placeholder="例如：张先生" />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, message: '请输入初始密码' }, { min: 8, message: '至少 8 个字符' }]}>
            <Input.Password autoComplete="new-password" placeholder="仅用于本次创建，不会回显" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码${resetTarget ? ` · ${resetTarget.displayName}` : ''}`}
        open={Boolean(resetTarget)}
        okText="确认重置"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => passwordForm.submit()}
        onCancel={() => { setResetTarget(null); passwordForm.resetFields() }}
        destroyOnHidden
      >
        <Alert type="warning" showIcon message="重置后，该用户已有登录会话会失效。" style={{ marginBottom: 16 }} />
        <Form form={passwordForm} layout="vertical" onFinish={handleResetPassword} requiredMark={false}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '至少 8 个字符' }]}>
            <Input.Password autoComplete="new-password" placeholder="密码不会在后台保存或回显" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={overviewTarget ? `用户详情 · ${overviewTarget.displayName}` : '用户详情'}
        open={Boolean(overviewTarget)}
        width={760}
        onClose={() => { setOverviewTarget(null); setOverview(null); setOverviewError('') }}
      >
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {overviewError && <Alert type="error" showIcon message="账号详情加载失败" description={overviewError} />}
          {overviewLoading && <Alert type="info" showIcon message="正在加载这个用户的命盘和报告…" />}
          {overview && <>
            <Card size="small">
              <Descriptions column={2} size="small" title="账号概览">
                <Descriptions.Item label="用户名">{overview.user.username}</Descriptions.Item>
                <Descriptions.Item label="显示名">{overview.user.displayName}</Descriptions.Item>
                <Descriptions.Item label="状态">{userStatusLabel(overview.user.status)}</Descriptions.Item>
                <Descriptions.Item label="工作区">{overview.user.hasBoundWorkspace ? '已绑定' : '尚未登录绑定'}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{dayjs(overview.user.createdAt).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
                <Descriptions.Item label="最近登录">{overview.user.lastLoginAt ? dayjs(overview.user.lastLoginAt).format('YYYY-MM-DD HH:mm') : '尚未登录'}</Descriptions.Item>
              </Descriptions>
            </Card>
            <Row gutter={12}>
              <Card size="small" style={{ flex: 1 }}><Statistic title="成员命盘" value={overview.charts.length} /></Card>
              <Card size="small" style={{ flex: 1 }}><Statistic title="住宅档案" value={overview.residences.length} /></Card>
              <Card size="small" style={{ flex: 1 }}><Statistic title="历史报告" value={overview.reports.active.length} /></Card>
              <Card size="small" style={{ flex: 1 }}><Statistic title="回收站报告" value={overview.reports.archived.length} /></Card>
            </Row>
            <Card size="small" title="成员命盘">
              {overview.charts.length ? <List
                dataSource={overview.charts}
                renderItem={(profile) => {
                  const counts = overview.reports.countsByChartProfileId[profile.id] ?? { active: 0, archived: 0 }
                  return <List.Item>
                    <List.Item.Meta
                      title={<Space>{profile.label}<Tag>{relationshipLabel[profile.relationship] ?? profile.relationship}</Tag>{profile.deletedAt && <Tag color="default">已删除</Tag>}</Space>}
                      description={[
                        `四柱：${profile.currentVersion.pillars.join(' / ')}`,
                        profile.currentVersion.birth ? `出生：${profile.currentVersion.birth.date} ${profile.currentVersion.birth.time}${profile.currentVersion.birth.locationName ? ` · ${profile.currentVersion.birth.locationName}` : ''}` : '手工四柱命盘',
                        `报告：${counts.active} 份，回收站：${counts.archived} 份`,
                      ].join('｜')}
                    />
                  </List.Item>
                }}
              /> : <Empty description={overview.user.hasBoundWorkspace ? '这个用户还没有创建成员命盘' : '用户首次登录后才会绑定工作区'} />}
            </Card>
            <Card size="small" title="住宅档案">
              {overview.residences.length ? <List
                dataSource={overview.residences}
                renderItem={(residence) => {
                  const counts = overview.reports.countsByResidenceProfileId[residence.id] ?? { active: 0, archived: 0 }
                  return <List.Item>
                    <List.Item.Meta
                      title={<Space>{residence.label}<Tag>{residence.facing}</Tag></Space>}
                      description={[
                        `版本：${residence.currentVersion.version}`,
                        `报告：${counts.active} 份，回收站：${counts.archived} 份`,
                      ].join('｜')}
                    />
                  </List.Item>
                }}
              /> : <Empty description="这个用户还没有保存住宅档案" />}
            </Card>
            <Card size="small" title="最近报告">
              {[...overview.reports.active, ...overview.reports.archived].length ? <List
                dataSource={[...overview.reports.active, ...overview.reports.archived].slice(0, 8)}
                renderItem={(report) => {
                  const profile = overview.charts.find((item) => item.id === report.chartProfileId)
                  const residence = overview.residences.find((item) => item.id === report.residenceProfileId)
                  return <List.Item>
                    <List.Item.Meta
                      title={<Space>{profile?.label ?? '未绑定成员'}<Tag>{reportStatusLabel(report)}</Tag><span>{dayjs(report.createdAt).format('YYYY-MM-DD HH:mm')}</span></Space>}
                      description={[
                        residence ? `住宅：${residence.label}` : report.residenceFacing ? `住宅朝向：${report.residenceFacing}` : '住宅朝向未知',
                        `照片：${report.photoCount} 张`,
                        report.reportPreview ? `摘要：${report.reportPreview}` : '',
                      ].filter(Boolean).join('｜')}
                    />
                  </List.Item>
                }}
              /> : <Empty description="暂无住宅报告" />}
            </Card>
          </>}
        </Space>
      </Drawer>
    </Space>
  )
}
