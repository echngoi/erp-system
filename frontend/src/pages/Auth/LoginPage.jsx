import { useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Space,
  Typography,
  message,
} from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import companyLogo from '../../assets/company-logo.svg';
import './LoginPage.css';

const { Title, Text } = Typography;

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const rememberedUsername = localStorage.getItem('remembered_username') || '';

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const response = await api.post('/auth/login/', {
        username: values.username.trim(),
        password: values.password,
      });

      const { access, refresh, user } = response.data || {};
      if (!access || !refresh || !user) {
        throw new Error('Invalid login response');
      }

      login({ access, refresh, user });

      if (values.remember) {
        localStorage.setItem('remembered_username', values.username.trim());
      } else {
        localStorage.removeItem('remembered_username');
      }

      message.success('Đăng nhập thành công');
      navigate('/dashboard', { replace: true });
    } catch (error) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;

      if (!status) {
        message.error(`Không kết nối được máy chủ (${api.defaults.baseURL}).`);
      } else {
        message.error(detail || `Đăng nhập thất bại (HTTP ${status}).`);
      }

      // Keep raw error in console for quick diagnosis during development.
      // eslint-disable-next-line no-console
      console.error('Login error:', {
        baseURL: api.defaults.baseURL,
        status,
        data: error?.response?.data,
        message: error?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <Card className="login-card">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="login-brand">
            <div className="login-brand-mark">
              <img src={companyLogo} width="40" height="40" alt="Company logo" />
            </div>
            <div>
              <Title level={3} style={{ margin: 0 }}>ERP Enterprise</Title>
              <Text type="secondary">Nền tảng vận hành nội bộ doanh nghiệp</Text>
            </div>
          </div>

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            autoComplete="off"
            initialValues={{
              username: rememberedUsername,
              remember: Boolean(rememberedUsername),
            }}
          >
            <Form.Item
              label="Username"
              name="username"
              rules={[
                { required: true, message: 'Vui lòng nhập username' },
                { min: 3, message: 'Username tối thiểu 3 ký tự' },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="Nhập username" />
            </Form.Item>

            <Form.Item
              label="Password"
              name="password"
              rules={[
                { required: true, message: 'Vui lòng nhập password' },
                { min: 6, message: 'Password tối thiểu 6 ký tự' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Nhập password" />
            </Form.Item>

            <Form.Item name="remember" valuePropName="checked" className="login-remember">
              <Checkbox>Remember me</Checkbox>
            </Form.Item>

            <Button type="primary" htmlType="submit" block loading={loading}>
              Đăng nhập
            </Button>

            <div className="login-footer">
              <Text type="secondary">Secure Sign-In for Internal Users</Text>
            </div>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
