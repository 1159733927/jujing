import { useState } from 'react'
import { Avatar, Button, Layout, Menu, Space, Typography, theme } from 'antd'
import {
  BookOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PartitionOutlined,
  UserOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAdminSession } from '../auth'

const { Header, Sider, Content } = Layout

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '监控仪表盘' },
  { key: '/users', icon: <TeamOutlined />, label: '用户账号' },
  { key: '/knowledge', icon: <BookOutlined />, label: '专家资料 / Skill' },
  { key: '/rule-profiles', icon: <PartitionOutlined />, label: '八字流派规则' },
  { key: '/wenzhen', icon: <ExperimentOutlined />, label: '问真对照' },
]

const menuKeys = menuItems.map((item) => item.key)

function selectedKeyFor(pathname: string): string {
  const match = menuKeys.find((key) => (key === '/' ? pathname === '/' : pathname.startsWith(key)))
  return match ?? '/'
}

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { session, logout } = useAdminSession()
  const { token } = theme.useToken()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        theme="light"
        width={236}
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            color: token.colorPrimary,
            fontFamily: 'Georgia, "Songti SC", serif',
            fontSize: collapsed ? 16 : 18,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {collapsed ? '居' : '居境 Compass'}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKeyFor(location.pathname)]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', paddingTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 20,
          }}
        >
          <Space size={12}>
            <Button
              type="text"
              aria-label={collapsed ? '展开菜单' : '收起菜单'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <Typography.Text strong>管理后台</Typography.Text>
          </Space>
          <Space size={12}>
            <Avatar size="small" icon={<UserOutlined />} style={{ background: token.colorPrimary }} />
            <Typography.Text type="secondary">{session?.username ?? '管理员'}</Typography.Text>
            <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout}>
              退出登录
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: token.colorBgLayout, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
