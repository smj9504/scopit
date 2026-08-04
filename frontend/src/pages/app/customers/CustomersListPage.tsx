/**
 * ScopeIt - Customers List Page
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Input, Card, Modal, Form, App, Spin } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  ExclamationCircleOutlined,
  EnvironmentOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, fonts, shadows } from '@/styles/theme';
import { customerService } from '@/services/customerService';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { Customer, CustomerCreate } from '@/types/entities';
import type { ColumnsType } from 'antd/es/table';

const CustomersListPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form] = Form.useForm();
  const isMobile = useIsMobile();

  // Fetch customers
  const { data, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => customerService.getList({ search: search || undefined, limit: 100 }),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CustomerCreate) => customerService.create(data),
    onSuccess: () => {
      message.success('Customer created successfully');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setModalOpen(false);
      form.resetFields();
    },
    onError: () => {
      message.error('Failed to create customer');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CustomerCreate> }) =>
      customerService.update(id, data),
    onSuccess: () => {
      message.success('Customer updated successfully');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setModalOpen(false);
      setEditingCustomer(null);
      form.resetFields();
    },
    onError: () => {
      message.error('Failed to update customer');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => customerService.delete(id),
    onSuccess: () => {
      message.success('Customer deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: () => {
      message.error('Failed to delete customer');
    },
  });

  const handleOpenModal = (customer?: Customer) => {
    if (customer) {
      setEditingCustomer(customer);
      form.setFieldsValue({
        name: customer.name,
        contactName: customer.contactName,
        email: customer.email,
        phone: customer.phone,
        addressLine1: customer.addressLine1,
        addressLine2: customer.addressLine2,
        city: customer.city,
        state: customer.state,
        zipcode: customer.zipcode,
        notes: customer.notes,
      });
    } else {
      setEditingCustomer(null);
      form.resetFields();
    }
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingCustomer(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingCustomer) {
        updateMutation.mutate({ id: editingCustomer.id, data: values });
      } else {
        createMutation.mutate(values);
      }
    } catch (error) {
      // Validation error
    }
  };

  const handleDelete = () => {
    if (!editingCustomer) return;
    Modal.confirm({
      title: 'Delete Customer',
      icon: <ExclamationCircleOutlined />,
      content: `Are you sure you want to delete "${editingCustomer.name}"? This action cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: () => {
        deleteMutation.mutate(editingCustomer.id);
        handleCloseModal();
      },
    });
  };

  const columns: ColumnsType<Customer> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      ellipsis: true,
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: colors.textPrimary }}>{text}</div>
          {record.contactName && (
            <div style={{ fontSize: 13, color: colors.textMuted }}>{record.contactName}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Contact',
      key: 'contact',
      width: 220,
      ellipsis: true,
      responsive: ['sm'] as const,
      render: (_, record) => (
        <div style={{ fontSize: 13 }}>
          {record.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textSecondary }}>
              <MailOutlined style={{ fontSize: 12 }} /> {record.email}
            </div>
          )}
          {record.phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textSecondary, marginTop: 3 }}>
              <PhoneOutlined style={{ fontSize: 12 }} /> {record.phone}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Location',
      key: 'location',
      width: 150,
      ellipsis: true,
      responsive: ['md'] as const,
      render: (_, record) => (
        <span style={{ color: colors.textSecondary, fontSize: 13 }}>
          {[record.city, record.state].filter(Boolean).join(', ') || '\u2014'}
        </span>
      ),
    },
  ];

  const customers = data?.items || [];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'center',
          flexDirection: isMobile ? 'column' : 'row',
          marginBottom: 20,
          gap: 12,
        }}
      >
        <h1 style={{ fontFamily: fonts.heading, fontSize: isMobile ? 20 : 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
          Customers
        </h1>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => handleOpenModal()}
          style={{ background: colors.primary, fontWeight: 600, borderRadius: 8, height: 36, width: isMobile ? '100%' : undefined }}
        >
          Add Customer
        </Button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="Search customers..."
          prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: isMobile ? '100%' : 320 }}
          allowClear
        />
      </div>

      {/* Mobile card view */}
      <div className="mobile-card-view">
        {isLoading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: colors.textMuted }}>
            Loading...
          </div>
        ) : customers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <TeamOutlined style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }} />
            <h3
              style={{
                fontFamily: fonts.heading,
                fontSize: 18,
                fontWeight: 600,
                color: colors.textPrimary,
                margin: '0 0 8px',
              }}
            >
              No customers yet
            </h3>
            <p
              style={{
                color: colors.textSecondary,
                marginBottom: 24,
                maxWidth: 320,
                margin: '0 auto 24px',
              }}
            >
              Add your first customer to attach them to estimates and invoices.
            </p>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => handleOpenModal()}
              style={{ background: colors.primary, fontWeight: 600, width: '100%' }}
            >
              Add Customer
            </Button>
          </div>
        ) : (
          customers.map((record) => (
            <div
              key={record.id}
              className="mobile-card"
              onClick={() => navigate(`/app/customers/${record.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div className="mobile-card-header">
                <span className="mobile-card-title">{record.name}</span>
              </div>
              {record.contactName && (
                <div className="mobile-card-row">
                  <span className="mobile-card-label">Contact</span>
                  <span className="mobile-card-value">{record.contactName}</span>
                </div>
              )}
              {record.email && (
                <div className="mobile-card-row">
                  <span className="mobile-card-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MailOutlined /> Email
                  </span>
                  <span className="mobile-card-value" style={{ maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {record.email}
                  </span>
                </div>
              )}
              {record.phone && (
                <div className="mobile-card-row">
                  <span className="mobile-card-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <PhoneOutlined /> Phone
                  </span>
                  <span className="mobile-card-value">{record.phone}</span>
                </div>
              )}
              {(record.city || record.state) && (
                <div className="mobile-card-row" style={{ borderBottom: 'none' }}>
                  <span className="mobile-card-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <EnvironmentOutlined /> Location
                  </span>
                  <span className="mobile-card-value">
                    {[record.city, record.state].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
        {customers.length > 0 && (
          <div style={{ textAlign: 'center', color: colors.textMuted, fontSize: 13, padding: '8px 0 4px' }}>
            {customers.length} customer{customers.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Desktop table */}
      <Card className="desktop-table" style={{ borderRadius: 12, boxShadow: shadows.card, overflow: 'hidden' }} styles={{ body: { padding: 0 } }}>
        <Spin spinning={isLoading}>
          <Table
            columns={columns}
            dataSource={customers}
            rowKey="id"
            scroll={{ x: 400 }}
            pagination={{ pageSize: 20, showTotal: (total) => `${total} customers` }}
            onRow={(record) => ({
              onClick: () => navigate(`/app/customers/${record.id}`),
              style: { cursor: 'pointer' },
            })}
            locale={{
              emptyText: (
                <div style={{ textAlign: 'center', padding: '60px 24px' }}>
                  <UserOutlined style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }} />
                  <h3
                    style={{
                      fontFamily: fonts.heading,
                      fontSize: 18,
                      fontWeight: 600,
                      color: colors.textPrimary,
                      margin: '0 0 8px',
                    }}
                  >
                    No customers yet
                  </h3>
                  <p
                    style={{
                      color: colors.textSecondary,
                      marginBottom: 24,
                      maxWidth: 320,
                      margin: '0 auto 24px',
                    }}
                  >
                    Add your first customer to attach them to estimates and invoices.
                  </p>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => handleOpenModal()}
                    style={{ background: colors.primary, fontWeight: 600 }}
                  >
                    Add Customer
                  </Button>
                </div>
              ),
            }}
          />
        </Spin>
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingCustomer ? 'Edit Customer' : 'Add Customer'}
        open={modalOpen}
        onCancel={handleCloseModal}
        afterOpenChange={(open) => {
          if (open && editingCustomer) {
            form.setFieldsValue({
              name: editingCustomer.name,
              contactName: editingCustomer.contactName,
              email: editingCustomer.email,
              phone: editingCustomer.phone,
              addressLine1: editingCustomer.addressLine1,
              addressLine2: editingCustomer.addressLine2,
              city: editingCustomer.city,
              state: editingCustomer.state,
              zipcode: editingCustomer.zipcode,
              notes: editingCustomer.notes,
            });
          }
        }}
        footer={
          <div style={{ display: 'flex', justifyContent: editingCustomer ? 'space-between' : 'flex-end' }}>
            {editingCustomer && (
              <Button danger onClick={handleDelete}>
                Delete
              </Button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={handleCloseModal}>Cancel</Button>
              <Button
                type="primary"
                onClick={handleSubmit}
                loading={createMutation.isPending || updateMutation.isPending}
                style={{ background: colors.primary }}
              >
                {editingCustomer ? 'Save Changes' : 'Add Customer'}
              </Button>
            </div>
          </div>
        }
      >
        <Form form={form} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Company / Customer Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="ABC Corporation" />
          </Form.Item>
          <Form.Item name="contactName" label="Contact Name">
            <Input placeholder="John Smith" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Please enter a valid email' }]}>
            <Input placeholder="john@example.com" />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input placeholder="555-0100" />
          </Form.Item>
          <Form.Item name="addressLine1" label="Address">
            <Input placeholder="123 Main St" />
          </Form.Item>
          <Form.Item name="addressLine2">
            <Input placeholder="Suite 100 (optional)" />
          </Form.Item>
          {/* City / State / ZIP: stack vertically on mobile */}
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 0 : 12 }}>
            <Form.Item name="city" label="City" style={{ flex: 1 }}>
              <Input placeholder="New York" />
            </Form.Item>
            <Form.Item name="state" label="State" style={isMobile ? {} : { width: 100 }}>
              <Input placeholder="NY" />
            </Form.Item>
            <Form.Item name="zipcode" label="ZIP" style={isMobile ? {} : { width: 100 }}>
              <Input placeholder="10001" />
            </Form.Item>
          </div>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea placeholder="Additional notes about this customer..." rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </motion.div>
  );
};

export default CustomersListPage;
