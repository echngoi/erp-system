import { Card, Space, Tag, Typography } from 'antd';

const { Paragraph, Title, Text } = Typography;

export default function AdminSectionPage({
  title,
  description,
  badge,
  extra,
  children,
}) {
  return (
    <Card bordered={false} style={{ borderRadius: 20 }}>
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Space
          size={12}
          align="start"
          style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          <Space direction="vertical" size={8}>
            <Space align="center" size={10}>
              <Title level={3} style={{ margin: 0 }}>{title}</Title>
              {badge ? <Tag color="blue">{badge}</Tag> : null}
            </Space>
            <Paragraph style={{ marginBottom: 0, maxWidth: 720, color: '#4b5563' }}>
              {description}
            </Paragraph>
            <Text type="secondary">
              Dữ liệu bên dưới đang được tải trực tiếp từ API quản trị.
            </Text>
          </Space>

          {extra ? <div>{extra}</div> : null}
        </Space>

        {children}
      </Space>
    </Card>
  );
}
