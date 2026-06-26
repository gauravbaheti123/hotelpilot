DELETE FROM role_permissions;
DELETE FROM permissions;

INSERT INTO permissions (module, action) VALUES
('dashboard','view'),('dashboard','create'),('dashboard','edit'),('dashboard','delete'),
('bookings','view'),('bookings','create'),('bookings','edit'),('bookings','delete'),
('calendar','view'),('calendar','create'),('calendar','edit'),('calendar','delete'),
('inhouse','view'),('inhouse','create'),('inhouse','edit'),('inhouse','delete'),
('food_dashboard','view'),('food_dashboard','create'),('food_dashboard','edit'),('food_dashboard','delete'),
('all_kots','view'),('all_kots','create'),('all_kots','edit'),('all_kots','delete'),
('new_kot','view'),('new_kot','create'),('new_kot','edit'),('new_kot','delete'),
('pending_bills','view'),('pending_bills','create'),('pending_bills','edit'),('pending_bills','delete'),
('pos','view'),('pos','create'),('pos','edit'),('pos','delete'),
('restaurant_billing','view'),('restaurant_billing','create'),('restaurant_billing','edit'),('restaurant_billing','delete'),
('invoices','view'),('invoices','create'),('invoices','edit'),('invoices','delete'),
('mis_ac','view'),('mis_ac','create'),('mis_ac','edit'),('mis_ac','delete'),
('reports','view'),('reports','create'),('reports','edit'),('reports','delete'),
('day_close','view'),('day_close','create'),('day_close','edit'),('day_close','delete'),
('room_board','view'),('room_board','create'),('room_board','edit'),('room_board','delete'),
('tasks','view'),('tasks','create'),('tasks','edit'),('tasks','delete'),
('guest_crm','view'),('guest_crm','create'),('guest_crm','edit'),('guest_crm','delete'),
('inventory','view'),('inventory','create'),('inventory','edit'),('inventory','delete'),
('expenses','view'),('expenses','create'),('expenses','edit'),('expenses','delete'),
('staff_hr','view'),('staff_hr','create'),('staff_hr','edit'),('staff_hr','delete'),
('banquet','view'),('banquet','create'),('banquet','edit'),('banquet','delete'),
('master_data','view'),('master_data','create'),('master_data','edit'),('master_data','delete'),
('settings_business','view'),('settings_business','create'),('settings_business','edit'),('settings_business','delete'),
('settings_whatsapp','view'),('settings_whatsapp','create'),('settings_whatsapp','edit'),('settings_whatsapp','delete'),
('settings_invoice','view'),('settings_invoice','create'),('settings_invoice','edit'),('settings_invoice','delete'),
('roles_permissions','view'),('roles_permissions','create'),('roles_permissions','edit'),('roles_permissions','delete'),
('user_management','view'),('user_management','create'),('user_management','edit'),('user_management','delete'),
('security_wipe','view'),('security_wipe','create'),('security_wipe','edit'),('security_wipe','delete');

-- OWNER: ALL ON
INSERT INTO role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE lower(r.name) = 'owner'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;

-- MANAGER: most ON, admin modules restricted to view only
INSERT INTO role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id,
  CASE
    WHEN p.module IN ('roles_permissions','user_management','security_wipe','settings_business')
         AND p.action IN ('create','edit','delete')
      THEN false
    ELSE true
  END
FROM roles r CROSS JOIN permissions p
WHERE lower(r.name) = 'manager'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;

-- RECEPTIONIST: limited
INSERT INTO role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id,
  CASE
    WHEN p.module = 'dashboard' AND p.action = 'view' THEN true
    WHEN p.module = 'bookings' AND p.action IN ('view','create','edit') THEN true
    WHEN p.module = 'calendar' AND p.action = 'view' THEN true
    WHEN p.module = 'inhouse' AND p.action IN ('view','create','edit') THEN true
    WHEN p.module = 'food_dashboard' AND p.action = 'view' THEN true
    WHEN p.module = 'all_kots' AND p.action = 'view' THEN true
    WHEN p.module = 'new_kot' AND p.action IN ('view','create') THEN true
    WHEN p.module = 'pending_bills' AND p.action = 'view' THEN true
    WHEN p.module = 'pos' AND p.action IN ('view','create') THEN true
    WHEN p.module = 'room_board' AND p.action IN ('view','edit') THEN true
    WHEN p.module = 'tasks' AND p.action IN ('view','create') THEN true
    ELSE false
  END
FROM roles r CROSS JOIN permissions p
WHERE lower(r.name) = 'receptionist'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;