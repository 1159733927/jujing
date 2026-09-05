import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  PartitionOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { getDashboard } from '../api'
import type { DashboardSnapshot } from '../types'

const POLL_INTERVAL_MS = 60_000

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchDashboard = useCallback(async () => {
    try {
      const snapshot = await getDashboard()
      if (!mountedRef.current) return
      setData(snapshot)
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void fetchDashboard()
    const timer = window.setInterval(() => {
      void fetchDashboard()
    }, POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      window.clearInterval(timer)
    }
  }, [fetchDashboard])

  async function handleRefresh() {
    setLoading(true)
    await fetchDashboard()
  }

  // ---------- render helpers ----------

  if (loading && !data) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" description="加载中…" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <Alert
        type="error"
        showIcon
        message="仪表盘加载失败"
        description={error}
        action={
          <Button size="small" onClick={handleRefresh}>
            重试
          </Button>
        }
      />
    )
  }

  if (!data) return null

  const { reports, charts, knowledge, ruleProfiles, wenzhen } = data
  const updatedAt = dayjs(data.generatedAt).format('HH:mm:ss')

  const finishedTotal = reports.completed + reports.failed
  const successRate = finishedTotal > 0 ? ((reports.completed / finishedTotal) * 100).toFixed(1) : null
  const hasFailures = reports.failed > 0

  return (
    <Space orientation="vertical" size={24} style={{ width: '100%' }}>
      {/* header bar */}
      <Row justify="space-between" align="middle">
        <Col>
          <Typography.Title level={4} style={{ margin: 0 }}>
            C 端监控仪表盘
          </Typography.Title>
        </Col>
        <Col>
          <Space size={12}>
            <Typography.Text type="secondary">更新于 {updatedAt}</Typography.Text>
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading}>
              刷新
            </Button>
          </Space>
        </Col>
      </Row>

      {error && (
        <Alert
          type="warning"
          showIcon
          message="最新数据拉取失败，当前展示的是上一次成功的数据"
          description={error}
        />
      )}

      {/* ===== C 端核心指标卡 ===== */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="报告累计"
              value={reports.total}
              prefix={<FileTextOutlined />}
            />
            <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              近 24 小时：{reports.last24h}
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="成功率"
              value={successRate !== null ? Number(successRate) : 0}
              precision={1}
              suffix={successRate !== null ? '%' : ''}
              formatter={() => (successRate !== null ? `${successRate}%` : '—')}
              styles={{ content: { color: '#3f8600' } }}
              prefix={<CheckCircleOutlined />}
            />
            <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              已完成 {reports.completed} / 已结束 {finishedTotal}
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="失败"
              value={reports.failed}
              styles={{ content: hasFailures ? { color: '#cf1322' } : undefined }}
              prefix={<WarningOutlined />}
            />
            {hasFailures && (
              <Tag color="orange" style={{ marginTop: 8 }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                排队中 {reports.queued}
              </Tag>
            )}
            {!hasFailures && reports.queued > 0 && (
              <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
                排队中 {reports.queued}
              </Typography.Text>
            )}
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="命盘"
              value={charts.total}
              suffix="累计"
              prefix={<DatabaseOutlined />}
            />
            <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              有效 {charts.active} · 已删除 {charts.deleted}
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      {/* ===== 内容运营 ===== */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card title="资料" size="small">
            <Statistic title="总量" value={knowledge.total} suffix={`已发布 ${knowledge.published}`} />
            <Space size={8} wrap style={{ marginTop: 12 }}>
              <Tag>文章 {knowledge.article}</Tag>
              <Tag>规则 {knowledge.rule}</Tag>
              <Tag>技能 {knowledge.skill}</Tag>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card title="规则" size="small">
            <Statistic title="规则画像" value={ruleProfiles.total} suffix={`已发布 ${ruleProfiles.published}`} />
            <Typography.Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
              生效版本 {ruleProfiles.activeVersions}
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card title="问真样例" size="small">
            <Statistic
              title="Fixture"
              value={wenzhen.fixtures}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* ===== 待接入面板（占位） ===== */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="近 30 天报告趋势图" size="small">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="待接入服务端聚合指标（后续增量）"
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="失败原因分布" size="small">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="待接入服务端聚合指标（后续增量）"
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="排盘坐标覆盖率" size="small">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="待接入服务端聚合指标（后续增量）"
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="媒体清理状态" size="small">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="待接入服务端聚合指标（后续增量）"
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="系统健康" size="small">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="待接入服务端聚合指标（后续增量）"
            />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
