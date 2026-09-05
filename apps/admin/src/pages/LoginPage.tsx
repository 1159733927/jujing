import { useState } from 'react'
import { Alert, Button, Card, Form, Input, Typography, theme } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../api'
import { useAdminSession } from '../auth'

type LoginFormValues = { username: string; password: string }

function describeLoginError(cause: unknown): string {
  if (cause instanceof ApiRequestError) {
    if (cause.status === 401) return '用户名或密码不正确'
    if (cause.status === 429) return '登录尝试过于频繁，请稍后再试'
    if (cause.status === 503) return '后台登录未配置：请在服务端设置 ADMIN_USERNAME 与 ADMIN_PASSWORD'
  }
  return cause instanceof Error ? cause.message : '登录失败'
}

export default function LoginPage() {
  const { status, login } = useAdminSession()
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to="/" replace />

  async function handleFinish(values: LoginFormValues) {
    setSubmitting(true)
    setError('')
    try {
      await login(values.username.trim(), values.password)
      navigate('/', { replace: true })
    } catch (cause) {
      setError(describeLoginError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: token.colorBgLayout,
        padding: 24,
      }}
    >
      <Card style={{ width: 384, boxShadow: token.boxShadowSecondary }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={3} style={{ marginBottom: 4, fontFamily: 'Georgia, "Songti SC", serif', color: token.colorPrimary }}>
            居境 Compass
          </Typography.Title>
          <Typography.Text type="secondary">管理后台登录</Typography.Text>
        </div>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={handleFinish} disabled={submitting} requiredMark={false}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" placeholder="管理员用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" placeholder="管理员密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
