import './theme.js';
import { getLanguage, setLanguage, translateUI, watchTranslations } from './i18n.js';
import './style.css';
import { getShedData } from './shedDashboard.js';
import { recordDateField, filterByDate } from './dateFilters.js';
import { icon } from './icons.js';
import { today, dateOffset, createEmptyData } from './data.js';
import { apiRoot, clearRemoteData, clearDemoStorage, getLocalData, isRemoteConnected, loadRemoteSettings, loadResource, persistLocal, saveRemoteSettings, saveResource, tryRemoteDelete } from './api.js';

const state = getLocalData();
const ui = { view: 'dashboard', search: '', filter: 'all', dateFrom: '', dateTo: '', page: 1, sort: '', direction: 1, range: 7, mobileOpen: false, notifications: false, session: null, apiHealth: null };
const pageSize = 8;
const shedOptions = () => state.sheds.map((shed) => shed.name);
const categories = ['Labour', 'Feed', 'Medicines', 'Transport', 'Electricity', 'Water', 'Repairs', 'Cleaning', 'Fuel', 'Supplies', 'Other'];
const paymentMethods = ['Cash', 'UPI', 'Bank'];
const workerOptions = () => state.workers.filter((worker) => worker.status === 'Active').map((worker) => ({ value: worker.id, label: worker.name }));
const select = (key, label, options, required = true) => ({ key, label, type: 'select', options, required });
const text = (key, label, required = true, placeholder = '') => ({ key, label, type: 'text', required, placeholder });
const number = (key, label, required = true, step = '1') => ({ key, label, type: 'number', required, min: '0', step });
const date = (key = 'date', label = 'Date') => ({ key, label, type: 'date', required: true });
const note = (key = 'notes', label = 'Notes') => ({ key, label, type: 'textarea', required: false, full: true });

const modules = {
  workers: {
    title: 'Workers', subtitle: 'Manage your team, shed assignments, and employment details.', key: 'workers', endpoint: '/workers', singular: 'worker', addLabel: 'Add worker',
    columns: [
      { key: 'name', label: 'Worker', render: (r) => `<div class="table-name">${esc(r.name)}</div><div class="table-sub">${esc(r.id)}</div>` },
      { key: 'phone', label: 'Phone' }, { key: 'role', label: 'Role' }, { key: 'assignedShed', label: 'Shed' },
      { key: 'salary', label: 'Wage / salary', format: 'money' }, { key: 'salaryType', label: 'Type' }, { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [text('name', 'Full name'), text('phone', 'Phone number'), text('address', 'Address'), date('joiningDate', 'Joining date'), select('assignedShed', 'Assigned shed', shedOptions), text('role', 'Role / job'), select('salaryType', 'Salary type', ['Monthly', 'Weekly', 'Daily']), number('salary', 'Wage / salary (₹)', true, '0.01'), select('status', 'Status', ['Active', 'Inactive']), text('emergencyContact', 'Emergency contact', false), note()],
    filterLabel: 'All sheds', filterField: 'assignedShed', filterOptions: shedOptions,
  },
  attendance: {
    title: 'Attendance', subtitle: 'Daily roll call, hours, and overtime across all sheds.', key: 'attendance', endpoint: '/attendance', singular: 'attendance record', addLabel: 'Record attendance',
    columns: [{ key: 'worker', label: 'Worker', render: (r) => `<div class="table-name">${esc(r.worker || workerName(r.workerId))}</div><div class="table-sub">${esc(workerShed(r.workerId))}</div>` }, { key: 'date', label: 'Date', format: 'date' }, { key: 'status', label: 'Status', format: 'badge' }, { key: 'checkIn', label: 'Check-in' }, { key: 'checkOut', label: 'Check-out' }, { key: 'workingHours', label: 'Hours', suffix: ' h' }, { key: 'overtime', label: 'Overtime', suffix: ' h' }],
    fields: [select('workerId', 'Worker', workerOptions), date(), select('status', 'Attendance status', ['Present', 'Absent', 'Half Day', 'Leave', 'Overtime']), { key: 'checkIn', label: 'Check-in', type: 'time', required: false }, { key: 'checkOut', label: 'Check-out', type: 'time', required: false }, number('overtime', 'Overtime hours', false, '0.25'), note()],
    filterLabel: 'All statuses', filterField: 'status', filterOptions: ['Present', 'Absent', 'Half Day', 'Leave', 'Overtime'],
  },
  payments: {
    title: 'Worker payments', subtitle: 'Track salaries, advances, bonuses, and outstanding balances.', key: 'payments', endpoint: '/worker-payments', singular: 'payment', addLabel: 'Record payment',
    columns: [{ key: 'worker', label: 'Worker', render: (r) => `<div class="table-name">${esc(r.worker || workerName(r.workerId))}</div>` }, { key: 'date', label: 'Date', format: 'date' }, { key: 'amount', label: 'Amount', format: 'money' }, { key: 'type', label: 'Type', format: 'badge' }, { key: 'method', label: 'Method' }, { key: 'paymentStatus', label: 'Payment status', format: 'badge' }, { key: 'reason', label: 'Description' }, { key: 'recordedBy', label: 'Recorded by' }],
    fields: [select('worker', 'Worker', () => state.workers.filter((w) => w.status === 'Active').map((w) => w.name)), date(), number('amount', 'Amount (₹)', true, '0.01'), select('type', 'Payment type', ['Salary', 'Advance', 'Bonus', 'Deduction', 'Other']), select('method', 'Payment method', paymentMethods), select('paymentStatus', 'Payment status', ['Paid', 'Pending', 'Partially Paid']), text('reason', 'Reason / description'), text('recordedBy', 'Recorded by', false)],
    filterLabel: 'All types', filterField: 'type', filterOptions: ['Salary', 'Advance', 'Bonus', 'Deduction', 'Other'],
  },
  feedStock: {
    title: 'Feed stock', subtitle: 'Current feed inventory, reorder thresholds, and stock health.', key: 'feedStock', endpoint: '/feed/stock', singular: 'feed item', addLabel: 'Add feed type',
    columns: [{ key: 'name', label: 'Feed name', render: (r) => `<div class="table-name">${esc(r.name)}</div><div class="table-sub">${esc(r.type)} feed</div>` }, { key: 'quantity', label: 'Current stock', suffix: ' kg', render: (r) => `<span class="${Number(r.quantity) <= Number(r.minStock) ? 'down' : ''}">${num(r.quantity)} kg</span>` }, { key: 'minStock', label: 'Minimum stock', suffix: ' kg' }, { key: 'updated', label: 'Last updated', format: 'date' }, { key: 'status', label: 'Stock status', render: (r) => badge(Number(r.quantity) <= Number(r.minStock) ? 'Low stock' : 'Healthy') }],
    fields: [text('name', 'Feed name'), select('type', 'Feed type', () => [...new Set(['Layer Feed', 'Layer Premium', 'Grower Feed', 'Starter Feed', ...state.feedStock.map((item) => item.type).filter(Boolean)])]), number('quantity', 'Current quantity (kg)', true, '0.1'), number('minStock', 'Minimum stock (kg)', true, '0.1'), date('updated', 'Last updated')],
    filterLabel: 'All feed types', filterField: 'type', filterOptions: ['Layer Feed', 'Layer Premium', 'Starter Feed', 'Grower Feed'],
  },
  feedUsage: {
    title: 'Daily feed usage', subtitle: 'Track consumption by shed and monitor daily, weekly, and monthly usage.', key: 'feedUsage', endpoint: '/feed/usage', singular: 'feed usage record', addLabel: 'Record usage',
    columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'shed', label: 'Shed' }, { key: 'feedType', label: 'Feed type' }, { key: 'quantity', label: 'Quantity', suffix: ' kg' }, { key: 'enteredBy', label: 'Entered by' }, { key: 'notes', label: 'Notes' }],
    fields: [date(), select('shed', 'Shed', shedOptions), select('feedType', 'Feed type', () => state.feedStock.map((r) => r.name)), number('quantity', 'Quantity used (kg)', true, '0.1'), text('enteredBy', 'Entered by', false), note()],
    filterLabel: 'All sheds', filterField: 'shed', filterOptions: shedOptions,
  },
  feedPurchases: {
    title: 'Feed purchases', subtitle: 'Record incoming feed and purchase prices; stock updates automatically.', key: 'feedPurchases', endpoint: '/feed/purchases', singular: 'feed purchase', addLabel: 'Record purchase',
    columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'feedType', label: 'Feed type' }, { key: 'quantity', label: 'Quantity', suffix: ' kg' }, { key: 'rate', label: 'Rate / kg', format: 'money' }, { key: 'totalAmount', label: 'Total', format: 'money' }, { key: 'supplier', label: 'Supplier' }],
    fields: [date(), select('feedType', 'Feed type', () => state.feedStock.map((r) => r.name)), number('quantity', 'Quantity (kg)', true, '0.1'), number('rate', 'Rate per kg (₹)', true, '0.01'), text('supplier', 'Supplier', false), note()],
    filterLabel: 'All feed types', filterField: 'feedType', filterOptions: () => state.feedStock.map((r) => r.name),
  },
  eggs: {
    title: 'Egg production', subtitle: 'Daily collection, good eggs, and breakage by shed.', key: 'eggs', endpoint: '/eggs', singular: 'production record', addLabel: 'Add egg count',
    columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'shed', label: 'Shed' }, { key: 'totalEggs', label: 'Total eggs', format: 'number' }, { key: 'goodEggs', label: 'Good eggs', format: 'number' }, { key: 'brokenEggs', label: 'Broken / damaged', format: 'number' }, { key: 'quality', label: 'Good rate', render: (r) => `${r.totalEggs ? Math.round((r.goodEggs / r.totalEggs) * 1000) / 10 : 0}%` }],
    fields: [date(), select('shed', 'Shed', shedOptions), number('totalEggs', 'Total eggs', true), number('goodEggs', 'Good eggs', true), number('brokenEggs', 'Broken / damaged eggs', true), note()],
    filterLabel: 'All sheds', filterField: 'shed', filterOptions: shedOptions,
  },
  mortality: {
    title: 'Mortality', subtitle: 'Record bird losses and reasons by shed; no complex medical workflow.', key: 'mortality', endpoint: '/mortality', singular: 'mortality record', addLabel: 'Record mortality',
    columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'shed', label: 'Shed' }, { key: 'count', label: 'Birds lost', format: 'number' }, { key: 'reason', label: 'Reason', format: 'badge' }, { key: 'notes', label: 'Notes' }],
    fields: [date(), select('shed', 'Shed', shedOptions), number('count', 'Death count', true), select('reason', 'Reason', ['Disease', 'Heat', 'Weakness', 'Injury', 'Unknown', 'Other']), note()],
    filterLabel: 'All sheds', filterField: 'shed', filterOptions: shedOptions,
  },
  sales: {
    title: 'Tray sales', subtitle: 'Daily tray sales and payment status. Each transaction keeps its own price.', key: 'sales', endpoint: '/sales', singular: 'tray sale', addLabel: 'Record sale',
    columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'trays', label: 'Trays sold', format: 'number' }, { key: 'pricePerTray', label: 'Price / tray', format: 'money' }, { key: 'totalAmount', label: 'Total amount', format: 'money' }, { key: 'buyer', label: 'Buyer' }, { key: 'paymentStatus', label: 'Payment', format: 'badge' }],
    fields: [date(), number('trays', 'Trays sold', true), number('pricePerTray', 'Price per tray (₹)', true, '0.01'), text('buyer', 'Buyer (optional)', false), select('paymentStatus', 'Payment status', ['Paid', 'Pending', 'Partial']), note()],
    filterLabel: 'All payment statuses', filterField: 'paymentStatus', filterOptions: ['Paid', 'Pending', 'Partial'],
  },
  expenses: {
    title: 'Daily expenses', subtitle: 'Farm spend by category, shed, supplier, and payment method.', key: 'expenses', endpoint: '/expenses', singular: 'expense', addLabel: 'Add expense',
    columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'category', label: 'Category', format: 'badge' }, { key: 'amount', label: 'Amount', format: 'money' }, { key: 'shed', label: 'Shed' }, { key: 'vendor', label: 'Paid to / vendor' }, { key: 'paymentMethod', label: 'Method' }, { key: 'description', label: 'Description' }],
    fields: [date(), select('category', 'Category', categories), number('amount', 'Amount (₹)', true, '0.01'), select('shed', 'Shed / farm-wide', () => [...shedOptions(), 'Common']), text('vendor', 'Paid to / vendor', false), select('paymentMethod', 'Payment method', paymentMethods), text('description', 'Description'), text('addedBy', 'Added by', false)],
    filterLabel: 'All categories', filterField: 'category', filterOptions: categories,
  },
  sheds: {
    title: 'Shed overview', subtitle: 'Add and edit sheds, review capacity, output, and staffing.', key: 'sheds', endpoint: '/sheds', singular: 'shed', addLabel: 'Add shed',
    columns: [{ key: 'name', label: 'Shed', render: (r) => `<div class="table-name">${esc(r.name)}</div><div class="table-sub">${esc(r.notes || 'Layer house')}</div>` }, { key: 'hens', label: 'Hens', format: 'number' }, { key: 'eggsToday', label: 'Eggs today', render: (r) => num(sum(state.eggs.filter((x) => x.date === today && x.shed === r.name), 'totalEggs')) }, { key: 'mortalityToday', label: 'Mortality', render: (r) => num(sum(state.mortality.filter((x) => x.date === today && x.shed === r.name), 'count')) }, { key: 'feedToday', label: 'Feed today', render: (r) => `${num(sum(state.feedUsage.filter((x) => x.date === today && x.shed === r.name), 'quantity'))} kg` }, { key: 'assignedWorkers', label: 'Workers', render: (r) => state.workers.filter((w) => w.assignedShed === r.name && w.status === 'Active').length }, { key: 'expensesToday', label: 'Expenses today', render: (r) => money(sum(state.expenses.filter((x) => x.date === today && x.shed === r.name), 'amount')) }],
    fields: [text('name', 'Shed name'), number('hens', 'Number of hens', true), text('notes', 'Description', false)], filterLabel: 'All sheds', filterField: 'name', filterOptions: shedOptions,
  },
  assignments: {
    title: 'Shed assignment history', subtitle: 'Historical worker assignments are retained when a person moves between sheds.', key: 'assignments', endpoint: '/worker-assignments', singular: 'assignment', addLabel: 'Record assignment',
    columns: [{ key: 'worker', label: 'Worker' }, { key: 'shed', label: 'Shed' }, { key: 'startDate', label: 'Start date', format: 'date' }, { key: 'endDate', label: 'End date', format: 'date' }, { key: 'reason', label: 'Reason' }],
    fields: [select('worker', 'Worker', () => state.workers.map((w) => w.name)), select('shed', 'Shed', shedOptions), date('startDate', 'Start date'), { key: 'endDate', label: 'End date', type: 'date', required: false }, text('reason', 'Reason', false)], filterLabel: 'All sheds', filterField: 'shed', filterOptions: shedOptions,
  },
  dailyWages: {
    title: 'Daily wages', subtitle: 'Link daily-wage work to a worker, shed, and payment status.', key: 'dailyWages', endpoint: '/daily-wages', singular: 'daily wage', addLabel: 'Add wage record',
    columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'worker', label: 'Worker' }, { key: 'shed', label: 'Shed' }, { key: 'work', label: 'Work' }, { key: 'wage', label: 'Wage', format: 'money' }, { key: 'paymentStatus', label: 'Payment', format: 'badge' }],
    fields: [select('worker', 'Worker', () => state.workers.filter((w) => w.status === 'Active').map((w) => w.name)), date(), select('shed', 'Shed', shedOptions), text('work', 'Work performed'), number('wage', 'Wage (₹)', true, '0.01'), select('paymentStatus', 'Payment status', ['Paid', 'Pending', 'Partially Paid'])], filterLabel: 'All sheds', filterField: 'shed', filterOptions: shedOptions,
  },
};

const navGroups = [
  { label: 'Overview', links: [{ id: 'dashboard', label: 'Overall dashboard', icon: 'dashboard' }] },
  { label: 'Production & sales', links: [{ id: 'eggs', label: 'Egg production', icon: 'egg' }, { id: 'mortality', label: 'Mortality', icon: 'pulse' }, { id: 'sales', label: 'Tray sales', icon: 'basket' }, { id: 'sheds', label: 'Shed overview', icon: 'building' }] },
  { label: 'Feed management', links: [{ id: 'feedStock', label: 'Feed stock', icon: 'package' }, { id: 'feedUsage', label: 'Daily usage', icon: 'leaf' }, { id: 'feedPurchases', label: 'Purchases', icon: 'basket' }] },
  { label: 'People', links: [{ id: 'workers', label: 'Workers', icon: 'users' }, { id: 'attendance', label: 'Attendance', icon: 'calendar' }, { id: 'assignments', label: 'Assignment history', icon: 'building' }] },
  { label: 'Finance & farm', links: [{ id: 'expenses', label: 'Daily expenses', icon: 'receipt' }, { id: 'payments', label: 'Worker payments', icon: 'wallet' }, { id: 'dailyWages', label: 'Daily wages', icon: 'receipt' }, { id: 'settings', label: 'Settings', icon: 'settings' }, { id: 'account', label: 'My Account', icon: 'users' }] },
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const accountName = () => ui.session?.name || (isRemoteConnected() ? state.settings?.owner : '') || 'Farm user';
const accountInitials = () => accountName().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'FU';
function greeting() {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = (ui.session?.name || (isRemoteConnected() ? state.settings?.owner : '') || 'Farmer').trim();
  const first = name.split(/\s+/)[0] || 'Farmer';
  return `${timeGreeting}, ${esc(first)}`;
}
function requestHeaders() {
  const headers = { Accept: 'application/json' };
  try { const token = sessionStorage.getItem('nestledger.apiToken'); if (token) headers.Authorization = `Bearer ${token}`; } catch {}
  return headers;
}
async function refreshSession() {
  try {
    const response = await fetch('/api/session', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    const payload = await response.json();
    ui.session = response.ok && payload.success === true ? payload.data : null;
  } catch { ui.session = null; }
  return ui.session;
}
async function refreshApiHealth() {
  try {
    const response = await fetch(`${apiRoot()}/api/health`, { headers: requestHeaders(), credentials: 'same-origin' });
    const payload = await response.json();
    ui.apiHealth = response.ok && payload.success === true ? payload.data : null;
  } catch { ui.apiHealth = null; }
  return ui.apiHealth;
}
async function refreshResources() {
  await Promise.all(Object.values(modules).map((def) => loadResource(def.endpoint, def.key).then((rows) => { if (Array.isArray(rows)) state[def.key] = rows; }).catch((err) => {
    if (err?.status === 401) throw err;
  })));
  if (isRemoteConnected()) {
    const remote = await loadRemoteSettings();
    if (remote) {
      if (ui.session) {
        state.settings = remote;
      } else {
        state.settings = { ...state.settings, ...remote };
      }
    }
  }
}
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const num = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number.isFinite(Number(value)) ? Number(value) : 0)}`;
const sum = (rows, key) => (rows || []).reduce((total, row) => total + Number(row[key] || 0), 0);
const todayRows = (rows) => (rows || []).filter((row) => row.date === today);
const currentMonthRows = (rows) => (rows || []).filter((row) => String(row.date || '').slice(0, 7) === today.slice(0, 7));
const workerName = (id) => state.workers.find((worker) => String(worker.id) === String(id))?.name || String(id || '—');
const workerShed = (id) => state.workers.find((worker) => String(worker.id) === String(id))?.assignedShed || '—';
const titleCase = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
const prettyDate = (value, options = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!value) return '—';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? esc(value) : new Intl.DateTimeFormat('en-IN', options).format(parsed);
};
const badge = (value) => {
  const lower = String(value || '').toLowerCase();
  const cls = /present|paid|active|healthy|salary|bonus/.test(lower) ? 'success' : /pending|partial|low|advance|half day|overtime/.test(lower) ? 'warning' : /absent|inactive|disease|injury/.test(lower) ? 'danger' : /leave|unknown|other|bank|upi/.test(lower) ? 'info' : '';
  return `<span class="badge ${cls}">${esc(value || '—')}</span>`;
};
const formatCell = (column, row) => {
  if (column.render) return column.render(row);
  const raw = row[column.key];
  if (column.format === 'money') return money(raw);
  if (column.format === 'number') return num(raw);
  if (column.format === 'date') return prettyDate(raw, { day: 'numeric', month: 'short' });
  if (column.format === 'badge') return badge(raw);
  if (column.suffix) return `${esc(raw ?? '—')}${column.suffix}`;
  return esc(raw || '—');
};

function renderSidebar() {
  return `<aside class="sidebar ${ui.mobileOpen ? 'open' : ''}" id="sidebar">
    <div class="brand"><div class="brand-mark">${icon('egg', 22)}</div><div><div class="brand-name">${esc((state.settings?.farmName || 'NESTLEDGER').toUpperCase())}</div><div class="brand-sub">${esc((state.settings?.owner ? state.settings.owner.toUpperCase() : 'FARM OPERATIONS'))}</div></div></div>
    <nav class="nav-scroll" aria-label="Farm operations navigation">${navGroups.map((group) => `<div class="nav-group"><div class="nav-label">${esc(group.label)}</div>${group.links.map((link) => `<button class="nav-link ${(ui.view === link.id || (link.id === 'dashboard' && ui.view.startsWith('dashboard-shed-'))) ? 'active' : ''}" data-action="navigate" data-view="${link.id}" aria-current="${(ui.view === link.id || (link.id === 'dashboard' && ui.view.startsWith('dashboard-shed-'))) ? 'page' : 'false'}">${icon(link.icon, 16)}<span>${esc(link.label)}</span>${link.id === 'payments' ? `<span class="nav-badge">${payrollDue().workersDue} due</span>` : link.badge ? `<span class="nav-badge">${link.badge}</span>` : ''}</button>`).join('')}</div>`).join('')}</nav>
    <div class="side-footer"><div class="connection-pill"><span class="connection-dot"></span><span>${isRemoteConnected() ? 'SHARED DATA · PostgreSQL database' : 'SIGN IN to access farm records'}</span></div><div class="profile"><div class="avatar">${esc(accountInitials())}</div><div><div class="profile-name">${esc(accountName())}</div><div class="profile-role">${ui.session ? `${esc(ui.session.role)} account` : 'Signed out'}</div></div></div></div>
  </aside><div class="mobile-overlay ${ui.mobileOpen ? 'show' : ''}" data-action="close-menu"></div>`;
}

function farmNotifications() {
  const items = [];
  const due = payrollDue();
  if (due.workersDue) items.push({ title: `Salary due · ${due.workersDue} worker${due.workersDue === 1 ? '' : 's'}`, description: `${money(due.amount)} estimated balance after recorded payments and advances.` });
  const unpaidSales = state.sales.filter((sale) => sale.paymentStatus !== 'Paid');
  if (unpaidSales.length) items.push({ title: `${unpaidSales.length} sale payment${unpaidSales.length === 1 ? '' : 's'} pending`, description: `${num(sum(unpaidSales, 'trays'))} trays · ${money(sum(unpaidSales, 'totalAmount'))} outstanding.` });
  const lowStock = state.feedStock.filter((item) => Number(item.quantity) <= Number(item.minStock));
  if (lowStock.length) items.push({ title: `Low feed stock · ${lowStock.length} item${lowStock.length === 1 ? '' : 's'}`, description: lowStock.map((item) => item.name).join(', ')});
  const missing = state.workers.filter((worker) => worker.status === 'Active' && !state.attendance.some((record) => record.date === today && String(record.workerId) === String(worker.id))).length;
  if (missing) items.push({ title: `Attendance missing · ${missing} worker${missing === 1 ? '' : 's'}`, description: 'Review today’s roll call across all sheds.' });
  return items;
}
function renderTopbar() {
  const title = ui.view.startsWith('dashboard-shed-') ? `${state.sheds.find((shed) => String(shed.id) === ui.view.split('-').pop())?.name || 'Shed'} dashboard` : ui.view === 'dashboard' ? 'Overall dashboard' : ui.view === 'settings' ? 'Farm settings' : ui.view === 'account' ? 'My Account' : modules[ui.view]?.title || 'Farm overview';

  const notices = farmNotifications();
  return `<header class="topbar"><div class="topbar-left"><button class="icon-button mobile-menu" data-action="toggle-menu" aria-label="Open navigation">${icon('menu', 18)}</button><div class="top-title">${esc(title)}</div><div class="top-date">${prettyDate(today, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div></div><div class="topbar-actions"><select id="languageSwitch" class="language-switch" aria-label="Language" data-no-translate><option value="en" ${getLanguage() === 'en' ? 'selected' : ''}>English</option><option value="te" ${getLanguage() === 'te' ? 'selected' : ''}>&#3108;&#3142;&#3122;&#3137;&#3095;&#3137;</option></select><label class="search-box" style="max-width:210px;min-width:160px;height:32px"><span>${icon('search', 14)}</span><input id="globalSearch" type="search" placeholder="Search this page…" value="${esc(ui.search)}" aria-label="Search this page"></label><button class="icon-button" data-action="notifications" aria-label="Notifications">${icon('bell', 16)}${notices.length ? '<span class="notification-dot"></span>' : ''}</button><div class="top-divider"></div><div class="profile top-profile"><div class="avatar">${esc(accountInitials())}</div><div><div class="profile-name">${esc(accountName())}</div><div class="profile-role">${ui.session ? `${esc(ui.session.role)} account` : 'Signed out'}</div></div><button class="btn btn-quiet" style="height:32px;padding:0 9px" data-action="${ui.session ? 'sign-out' : 'sign-in'}">${ui.session ? 'Sign out' : 'Sign in'}</button></div></div>${ui.notifications ? `<div class="notice-popover"><div class="notice-head">Farm alerts</div>${notices.length ? notices.map((item) => `<div class="notice-line">${esc(item.title)}<span>${esc(item.description)}</span></div>`).join('') : '<div class="notice-line">No urgent reminders<span>All key records look current.</span></div>'}</div>` : ''}</header>`;
}

function pageHeading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${ui.view === 'dashboard' ? `${new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(new Date()).toUpperCase()} · FARM OPERATIONS` : 'FARM OPERATIONS'}</div><h1>${esc(title)}</h1><div class="page-subtitle">${esc(subtitle)}</div></div><div class="heading-actions">${actions}</div></div>`;
}
function connectionBanner() {
  const live = isRemoteConnected();
  const message = live ? 'Connected to shared PostgreSQL farm database.' : ui.session ? 'Signed in; shared PostgreSQL records active.' : 'Sign in to access your shared farm records.';
  return `<div class="connection-banner">${icon('spark', 15)}<span><b>${live ? 'PostgreSQL database' : 'Sign in required'}</b> · ${message}</span><button class="banner-link" data-action="${!ui.session ? 'sign-in' : 'navigate'}" data-view="settings">${!ui.session ? 'Sign in' : 'Data settings'}</button></div>`;
}

function currentMetrics() {
  const totalHens = sum(state.sheds, 'hens');
  const eggsToday = sum(todayRows(state.eggs), 'totalEggs');
  const deathsToday = sum(todayRows(state.mortality), 'count');
  const traysToday = sum(todayRows(state.sales), 'trays');
  const salesToday = sum(todayRows(state.sales), 'totalAmount');
  const expensesToday = sum(todayRows(state.expenses), 'amount');
  const present = todayRows(state.attendance).filter((row) => row.status === 'Present').length;
  const feedStock = sum(state.feedStock, 'quantity');
  return { totalHens, eggsToday, deathsToday, traysToday, salesToday, expensesToday, present, feedStock };
}
function metricCard(label, value, foot, iconName, tone = 'green', footTone = 'up') {
  const colors = tone === 'amber' ? ['var(--yolk-wash)', 'var(--yolk-text)', 'var(--yolk-wash)'] : tone === 'red' ? ['var(--red-wash)', 'var(--red)', 'var(--red-wash)'] : tone === 'blue' ? ['var(--neutral-wash)', 'var(--text)', 'var(--neutral-wash)'] : ['var(--green-wash)', 'var(--green)', 'var(--green-wash)'];
  return `<article class="stat-card" data-tone="${tone}" style="--tone:${colors[0]};--toneText:${colors[1]};--glow:${colors[2]}"><div class="stat-top"><div class="stat-label">${esc(label)}</div><div class="stat-icon">${icon(iconName, 15)}</div></div><div class="stat-value">${value}</div><div class="stat-foot"><span class="${footTone}">${esc(foot)}</span></div></article>`;
}

function chartSvg(values, labels, showDots = true) {
  const width = 620; const height = 184; const left = 42; const right = 10; const top = 12; const bottom = 25;
  const safeValues = values && values.length ? values.map((v) => Number.isFinite(Number(v)) ? Number(v) : 0) : [0];
  const safeLabels = labels && labels.length ? labels : ['Today'];
  const maxValue = Math.max(1000, Math.ceil(Math.max(...safeValues, 0) / 1000) * 1000);
  const x = (index) => left + index * ((width - left - right) / Math.max(safeValues.length - 1, 1));
  const y = (value) => top + (height - top - bottom) * (1 - value / maxValue);
  const points = safeValues.map((value, index) => `${x(index)},${y(value)}`);
  const area = `M${x(0)},${height - bottom} L${points.join(' L')} L${x(safeValues.length - 1)},${height - bottom} Z`;
  const grid = [0, .33, .66, 1].map((fraction) => {
    const gy = top + fraction * (height - top - bottom);
    return `<line class="chart-gridline" x1="${left}" y1="${gy}" x2="${width - right}" y2="${gy}"/><text class="chart-label" x="0" y="${gy + 3}">${num(maxValue * (1 - fraction) / 1000)}k</text>`;
  }).join('');
  const dateLabels = safeLabels.map((label, index) => (index === 0 || index === safeLabels.length - 1 || index === Math.floor(safeLabels.length / 2)) ? `<text class="chart-label" text-anchor="middle" x="${x(index)}" y="${height - 5}">${esc(label)}</text>` : '').join('');
  const dots = showDots ? safeValues.map((value, index) => `<circle class="chart-dot" cx="${x(index)}" cy="${y(value)}" r="3.3"><title>${esc(safeLabels[index] || '')}: ${num(value)} eggs</title></circle>`).join('') : '';
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily egg production trend for the last ${safeValues.length} days"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--green)" stop-opacity=".23"/><stop offset="100%" stop-color="var(--green)" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><polyline class="chart-line" points="${points.join(' ')}"/>${dots}${dateLabels}</svg>`;
}
function lastDays(count) { return Array.from({ length: count }, (_, index) => dateOffset(index - (count - 1))); }
function dailySeries(key, metric, count = 7) {
  return lastDays(count).map((day) => sum(state[key].filter((record) => record.date === day), metric));
}
function barChart() {
  const dates = lastDays(7);
  const sales = dates.map((day) => sum(state.sales.filter((record) => record.date === day), 'totalAmount'));
  const expenses = dates.map((day) => sum(state.expenses.filter((record) => record.date === day), 'amount'));
  const max = Math.max(...sales, ...expenses, 1);
  return `<div class="rev-bars" aria-label="Sales and expense totals by day">${dates.map((day, index) => `<div class="bar-pair"><div class="bar" style="height:${Math.max(3, Math.round((sales[index] / max) * 100))}%" title="Sales ${money(sales[index])}"></div><div class="bar expense" style="height:${Math.max(3, Math.round((expenses[index] / max) * 100))}%" title="Expenses ${money(expenses[index])}"></div><span class="bar-day">${new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(new Date(`${day}T12:00:00`))}</span></div>`).join('')}</div><div class="rev-legend"><span class="legend-item"><i class="legend-dot"></i>Sales</span><span class="legend-item"><i class="legend-dot amber"></i>Expenses</span></div>`;
}
function shedCard(shed) {
  const shedName = shed.name;
  const hens = Number(shed.hens || 0);
  const eggs = sum(state.eggs.filter((r) => r.date === today && r.shed === shedName), 'totalEggs');
  const mortality = sum(state.mortality.filter((r) => r.date === today && r.shed === shedName), 'count');
  const feed = sum(state.feedUsage.filter((r) => r.date === today && r.shed === shedName), 'quantity');
  const workers = state.workers.filter((worker) => worker.assignedShed === shedName && worker.status === 'Active').length;
  const expenses = sum(state.expenses.filter((r) => r.date === today && r.shed === shedName), 'amount');
  return `<article class="shed-card"><div class="shed-card-top"><div class="shed-name">${esc(shedName)}</div><button class="btn btn-small" data-action="navigate" data-view="dashboard-shed-${shed.id}">Open dashboard</button><div class="shed-state">Operational</div></div><div class="shed-hens">${num(hens)}</div><div class="shed-hens-label">hens housed</div><div class="shed-progress"><span style="width:${Math.min(100, Math.round((hens / 4500) * 100))}%"></span></div><div class="shed-metrics"><div><div class="shed-metric-label">EGGS TODAY</div><div class="shed-metric-val">${num(eggs)}</div></div><div><div class="shed-metric-label">MORTALITY</div><div class="shed-metric-val ${mortality > 4 ? 'down' : ''}">${num(mortality)} birds</div></div><div><div class="shed-metric-label">FEED USED</div><div class="shed-metric-val">${num(feed)} kg</div></div><div><div class="shed-metric-label">WORKERS</div><div class="shed-metric-val">${workers} assigned</div></div><div><div class="shed-metric-label">EXPENSES TODAY</div><div class="shed-metric-val">${money(expenses)}</div></div></div></article>`;
}
function monthlySummary() {
  const month = currentMonthRows(state.sales);
  const expenses = currentMonthRows(state.expenses);
  const payments = currentMonthRows(state.payments);
  const feedPurchases = currentMonthRows(state.feedPurchases);
  const feedExpenses = sum(feedPurchases, 'totalAmount');
  const wageSpend = sum(payments.filter((payment) => payment.type === 'Salary'), 'amount') + sum(currentMonthRows(state.dailyWages).filter((wage) => wage.paymentStatus === 'Paid'), 'wage');
  const totalSales = sum(month, 'totalAmount');
  const totalExpenses = sum(expenses, 'amount') + feedExpenses;
  const net = totalSales - totalExpenses;
  const eggs = sum(currentMonthRows(state.eggs), 'totalEggs');
  const trays = sum(month, 'trays');
  return `<div class="monthly-strip"><div class="monthly-net"><div class="monthly-label">${new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(`${today}T12:00:00`))} net amount</div><div class="monthly-value">${money(net)}</div><div class="monthly-note">Sales less recorded expenses</div></div><div class="month-cell"><div class="month-cell-label">Total sales</div><div class="month-cell-value">${money(totalSales)}</div><div class="month-cell-delta">${num(trays)} trays sold</div></div><div class="month-cell"><div class="month-cell-label">Total expenses</div><div class="month-cell-value">${money(totalExpenses)}</div><div class="month-cell-delta">${money(wageSpend)} wages paid</div></div><div class="month-cell"><div class="month-cell-label">Egg production</div><div class="month-cell-value">${num(eggs)}</div><div class="month-cell-delta">${num(trays)} trays · ${money(feedExpenses)} feed</div></div><div class="month-cell"><div class="month-cell-label">Feed expenses</div><div class="month-cell-value">${money(feedExpenses)}</div><div class="month-cell-delta">${num(sum(currentMonthRows(state.feedUsage), 'quantity'))} kg used</div></div></div>`;
}
function dashboardTabs() {
  const tabs = [{ id: 'dashboard', label: 'Overall dashboard' }, ...state.sheds.map((shed) => ({ id: `dashboard-shed-${shed.id}`, label: `${shed.name} dashboard` }))];
  return `<nav class="dashboard-tabs" aria-label="Dashboards">${tabs.map((tab) => `<button class="dashboard-tab ${ui.view === tab.id ? 'active' : ''}" data-action="navigate" data-view="${tab.id}" aria-current="${ui.view === tab.id ? 'page' : 'false'}">${esc(tab.label)}</button>`).join('')}</nav>`;
}

function renderDashboard() {
  const metrics = currentMetrics();
  const dates = lastDays(ui.range);
  const production = dates.map((day) => sum(state.eggs.filter((row) => row.date === day), 'totalEggs'));
  const labels = dates.map((day) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00`)));
  const alerts = [];
  state.feedStock.filter((item) => Number(item.quantity) <= Number(item.minStock)).forEach((item) => alerts.push({ type: 'critical', title: `Low ${item.name.toLowerCase()} stock`, copy: `${num(item.quantity)} kg remaining · reorder threshold ${num(item.minStock)} kg` }));
  const pendingSale = state.sales.find((sale) => sale.paymentStatus !== 'Paid');
  if (pendingSale) alerts.push({ type: 'warning', title: 'Sale payment pending', copy: `${num(pendingSale.trays)} trays · ${money(pendingSale.totalAmount)} outstanding` });
  const activeMonthly = state.workers.filter((worker) => worker.status === 'Active' && worker.salaryType === 'Monthly');
  const duePayroll = payrollDue();
  const salaryDue = duePayroll.workersDue;
  if (salaryDue) alerts.push({ type: 'warning', title: `Salary due · ${salaryDue} worker${salaryDue > 1 ? 's' : ''}`, copy: 'Review monthly salary payments and advances before month-end.' });
  const missing = state.workers.filter((worker) => worker.status === 'Active' && !state.attendance.some((record) => record.date === today && String(record.workerId) === String(worker.id))).length;
  if (missing) alerts.push({ type: 'critical', title: `${missing} attendance record${missing > 1 ? 's' : ''} missing`, copy: 'Complete the daily roll call for all active workers.' });
  if (!alerts.length) alerts.push({ type: 'clear', title: 'Operations look steady', copy: 'Feed stock is above minimum and today’s records are up to date.' });
  const activity = [
    { icon: 'egg', tone: '', main: `<b>${num(metrics.eggsToday)} eggs collected</b> across all sheds`, time: 'Today · Production log' },
    { icon: 'basket', tone: 'amber', main: `<b>${num(metrics.traysToday)} trays sold</b> for ${money(metrics.salesToday)}`, time: 'Today · Tray sales' },
    { icon: 'pulse', tone: 'red', main: `<b>${num(metrics.deathsToday)} bird losses</b> recorded across the farm`, time: 'Today · Mortality log' },
    { icon: 'wallet', tone: '', main: `<b>${money(metrics.expensesToday)} expenses</b> entered for today`, time: 'Today · Farm expenses' },
  ];
  const feedCapacity = Number(state.settings?.feedCapacity) || 6000;
  const stockPct = feedCapacity > 0 ? Math.round((metrics.feedStock / feedCapacity) * 100) : 0;
  const layRate = metrics.totalHens > 0 ? ((metrics.eggsToday / metrics.totalHens) * 100).toFixed(1) : '0.0';
  return `${connectionBanner()}${pageHeading('Overall dashboard', 'Here’s your farm at a glance. Keep the day moving.', `<div class="date-chip">${icon('calendar', 14)}${prettyDate(today, { weekday: 'short', day: 'numeric', month: 'short' })}</div><button class="btn btn-primary" data-action="quick-entry">${icon('plus', 15)} Add record</button>`)}
    <section class="stats-grid" aria-label="Today's farm statistics">
      ${metricCard('Eggs today', num(metrics.eggsToday), `${layRate}% lay rate`, 'egg')}
      ${metricCard('Feed used today', `${num(sum(todayRows(state.feedUsage), 'quantity'))} kg`, 'All farm sheds', 'leaf')}
      ${metricCard('Mortality today', num(metrics.deathsToday), 'Deaths recorded today', 'pulse', 'red', 'down')}
      ${metricCard('Expenses today', money(metrics.expensesToday), 'Farm spend recorded', 'receipt', 'red', 'down')}
    </section>
    <section class="dashboard-grid"><article class="panel"><div class="panel-head"><div><div class="panel-title">Egg production trend</div><div class="panel-sub">Daily collection · all sheds</div></div><div class="segmented"><button class="segment ${ui.range === 7 ? 'active' : ''}" data-action="range" data-range="7">7D</button><button class="segment ${ui.range === 14 ? 'active' : ''}" data-action="range" data-range="14">14D</button><button class="segment ${ui.range === 30 ? 'active' : ''}" data-action="range" data-range="30">30D</button></div></div><div class="chart-legend"><span class="legend-item"><i class="legend-dot"></i>Eggs collected</span></div><div class="chart-wrap">${chartSvg(production, labels)}</div></article><article class="panel"><div class="panel-head"><div><div class="panel-title">Sales vs expenses</div><div class="panel-sub">Daily comparison · last 7 days</div></div><button class="btn btn-quiet btn-small" data-action="navigate" data-view="expenses">Details ${icon('arrow', 12)}</button></div>${barChart()}</article></section>
    ${monthlySummary()}
    <div class="shed-section-head"><div class="section-title">Shed performance</div><button class="section-link" data-action="navigate" data-view="sheds">View shed details ${icon('chevron', 14)}</button></div>
    <section class="shed-grid">${state.sheds.map(shedCard).join('')}</section>
    <section class="activity-grid"><article class="panel"><div class="panel-head"><div><div class="panel-title">Today’s activity</div><div class="panel-sub">A quick pulse on the farm floor</div></div><button class="btn btn-quiet btn-small" data-action="navigate" data-view="eggs">Production log ${icon('arrow', 12)}</button></div><div class="activity-list">${activity.map((item) => `<div class="activity-item"><div class="activity-icon ${item.tone}">${icon(item.icon, 14)}</div><div><div class="activity-main">${item.main}</div><div class="activity-time">${item.time}</div></div></div>`).join('')}</div></article><article class="panel"><div class="panel-head"><div><div class="panel-title">Needs attention</div><div class="panel-sub">Simple reminders to keep records complete</div></div>${icon('warning', 16)}</div><div class="alert-list">${alerts.slice(0, 4).map((item) => `<div class="alert-row ${item.type === 'critical' ? 'critical' : ''}">${icon(item.type === 'clear' ? 'check' : 'warning', 15)}<div><div class="alert-title">${esc(item.title)}</div><div class="alert-copy">${esc(item.copy)}</div></div></div>`).join('')}</div></article></section>`;
}

function renderShedDashboard(shedId) {
  const data = getShedData(state, shedId);
  if (!data) return `${connectionBanner()}${pageHeading(`Shed ${shedId} dashboard`, 'Sign in to view this shed.')}<div class="callout">No shed data is available.</div>`;
  const { shed, workers, attendance, eggs, mortality, feedUsage, expenses } = data;
  const active = workers.filter((row) => row.status === 'Active');
  const eggsToday = sum(todayRows(eggs), 'totalEggs');
  const hens = Number(shed.hens) || 0;
  const dates = lastDays(ui.range);
  const labels = dates.map((day) => prettyDate(day, { day: 'numeric', month: 'short' }));
  const production = dates.map((day) => sum(eggs.filter((row) => row.date === day), 'totalEggs'));
  const presentIds = new Set(todayRows(attendance).filter((row) => row.status === 'Present').map((row) => String(row.workerId)));
  const missing = active.filter((worker) => !todayRows(attendance).some((row) => String(row.workerId) === String(worker.id))).length;
  const logLink = (view, label) => `<button class="btn btn-quiet btn-small" data-action="shed-records" data-view="${view}" data-shed="${esc(shed.name)}">${esc(label)} ${icon('arrow', 12)}</button>`;
  return `${connectionBanner()}${pageHeading(`${shed.name} dashboard`, `Production, feed usage, expenses, and workers for ${shed.name}.`, `<div class="date-chip">${icon('calendar', 14)}${prettyDate(today, { day: 'numeric', month: 'short' })}</div><button class="btn" data-action="navigate" data-view="dashboard">Overall dashboard</button>`)}
    <section class="stats-grid" aria-label="Shed statistics">
      ${metricCard('Total hens', num(hens), shed.name, 'egg')}
      ${metricCard('Eggs today', num(eggsToday), `${hens > 0 ? (eggsToday / hens * 100).toFixed(1) : '0.0'}% lay rate`, 'egg')}
      ${metricCard('Mortality today', num(sum(todayRows(mortality), 'count')), 'Bird losses recorded', 'pulse', 'red', 'down')}
      ${metricCard('Feed used today', `${num(sum(todayRows(feedUsage), 'quantity'))} kg`, 'Shed consumption', 'leaf')}
      ${metricCard('Expenses today', money(sum(todayRows(expenses), 'amount')), 'Shed expenses', 'receipt', 'red', 'down')}
      ${metricCard('Workers present', `${active.filter((worker) => presentIds.has(String(worker.id))).length} / ${active.length}`, 'Active assigned workers', 'users', 'blue')}
      ${metricCard('Eggs this month', num(sum(currentMonthRows(eggs), 'totalEggs')), 'Monthly production', 'egg')}
      ${metricCard('Expenses this month', money(sum(currentMonthRows(expenses), 'amount')), 'Shed expense log', 'wallet', 'red', 'down')}
    </section>
    <section class="dashboard-grid"><article class="panel"><div class="panel-head"><div><div class="panel-title">Egg production trend</div><div class="panel-sub">${esc(shed.name)} daily collection</div></div><div class="segmented">${[7, 14, 30].map((range) => `<button class="segment ${ui.range === range ? 'active' : ''}" data-action="range" data-range="${range}">${range}D</button>`).join('')}</div></div><div class="chart-wrap">${chartSvg(production, labels)}</div>${logLink('eggs', 'Production history')}</article>
    <article class="panel"><div class="panel-head"><div><div class="panel-title">Monthly shed activity</div><div class="panel-sub">Current month totals</div></div></div><div class="activity-list">${[
      ['Feed used', `${num(sum(currentMonthRows(feedUsage), 'quantity'))} kg`],
      ['Bird losses', num(sum(currentMonthRows(mortality), 'count'))],
      ['Good eggs', num(sum(currentMonthRows(eggs), 'goodEggs'))],
      ['Broken eggs', num(sum(currentMonthRows(eggs), 'brokenEggs'))],
    ].map(([label, value]) => `<div class="activity-item"><div class="activity-main">${esc(label)}: <b>${value}</b></div></div>`).join('')}</div><div class="settings-actions">${logLink('feedUsage', 'Feed history')}${logLink('expenses', 'Expense history')}</div></article></section>
    <section class="activity-grid"><article class="panel"><div class="panel-head"><div><div class="panel-title">Assigned workers</div><div class="panel-sub">${active.length} active workers</div></div>${logLink('workers', 'View workers')}</div><div class="activity-list">${workers.length ? workers.map((worker) => `<div class="activity-item"><div class="activity-main"><b data-no-translate>${esc(worker.name)}</b><div class="activity-time">${esc(worker.role)} - ${esc(worker.status)}</div></div></div>`).join('') : '<div class="callout">No workers assigned to this shed yet.</div>'}</div></article>
    <article class="panel"><div class="panel-head"><div class="panel-title">Shed reminders</div></div><div class="callout">${missing ? `${missing} active worker(s) need attendance recorded today.` : 'Attendance is complete for active assigned workers.'}</div><div class="callout">Sales, feed stock, and feed purchases are shared farm records. View these totals in the Overall dashboard.</div>${logLink('mortality', 'Mortality history')}</article></section>`;
}

function summaryTiles(def) {
  const rows = state[def.key] || [];
  let items = [];
  if (recordDateField(def) && (ui.dateFrom || ui.dateTo)) {
    const selected = filterRows(def, rows);
    const period = `${ui.dateFrom || 'Beginning'} to ${ui.dateTo || 'Latest'}`;
    items = [['Matching records', num(selected.length), period]];
    const totals = {
      eggs: [['Total eggs', 'totalEggs'], ['Good eggs', 'goodEggs'], ['Broken eggs', 'brokenEggs']],
      sales: [['Trays sold', 'trays'], ['Sales amount', 'totalAmount', 'money']],
      expenses: [['Total expenses', 'amount', 'money']],
      payments: [['Total payments', 'amount', 'money']],
      dailyWages: [['Total wages', 'wage', 'money']],
      feedUsage: [['Feed used', 'quantity', 'kg']],
      feedPurchases: [['Feed purchased', 'quantity', 'kg'], ['Purchase amount', 'totalAmount', 'money']],
      feedStock: [['Feed quantity', 'quantity', 'kg']],
      mortality: [['Bird losses', 'count']],
      attendance: [['Working hours', 'workingHours', 'hours'], ['Overtime', 'overtime', 'hours']],
    };
    for (const [label, key, format] of totals[def.key] || []) {
      const total = sum(selected, key);
      items.push([label, format === 'money' ? money(total) : `${num(total)}${format === 'kg' ? ' kg' : format === 'hours' ? ' h' : ''}`, 'Selected records']);
    }
    if (def.key === 'attendance') items.push(['Present records', selected.filter((row) => row.status === 'Present').length, 'Selected records']);
    return `<div class="summary-grid">${items.map(([label, value, noteText]) => `<div class="summary-tile"><div class="summary-label">${esc(label)}</div><div class="summary-value">${value}</div><div class="summary-note">${esc(noteText)}</div></div>`).join('')}</div>`;
  }
  if (def.key === 'workers') items = [['Active workers', rows.filter((r) => r.status === 'Active').length, 'Across all sheds'], ['Monthly payroll', money(sum(rows.filter((r) => r.salaryType === 'Monthly' && r.status === 'Active'), 'salary')), 'Before advances & deductions'], ['Present today', todayRows(state.attendance).filter((r) => r.status === 'Present').length, 'Attendance recorded'], ['Pending wages', money(sum(state.dailyWages.filter((r) => r.paymentStatus !== 'Paid'), 'wage')), 'Daily wage records']];
  else if (def.key === 'attendance') items = [['Present today', todayRows(rows).filter((r) => r.status === 'Present').length, 'Workers marked present'], ['Absent today', todayRows(rows).filter((r) => r.status === 'Absent').length, 'Review attendance'], ['Leave / half day', todayRows(rows).filter((r) => ['Leave', 'Half Day'].includes(r.status)).length, 'Today’s roster'], ['Overtime this month', `${num(sum(currentMonthRows(rows), 'overtime'))} h`, 'Across all workers']];
  else if (def.key === 'payments') items = [['Paid this month', money(sum(currentMonthRows(rows).filter((r) => r.paymentStatus === 'Paid' || r.paymentStatus === 'Partially Paid'), 'amount')), 'Recorded cash / bank payments'], ['Salary payable', money(payrollDue().amount), `${payrollDue().workersDue} workers still due`], ['Open daily wages', money(sum(state.dailyWages.filter((r) => r.paymentStatus !== 'Paid'), 'wage')), 'Pending / partial'], ['Advances this month', money(sum(currentMonthRows(rows).filter((r) => r.type === 'Advance'), 'amount')), 'Deducted from payable']];
  else if (def.key === 'feedStock') items = [['Current feed stock', `${num(sum(rows, 'quantity'))} kg`, 'All feed types'], ['Today’s usage', `${num(sum(todayRows(state.feedUsage), 'quantity'))} kg`, 'All farm sheds'], ['This month used', `${num(sum(currentMonthRows(state.feedUsage), 'quantity'))} kg`, 'Feed consumption'], ['Low-stock items', rows.filter((r) => Number(r.quantity) <= Number(r.minStock)).length, 'At or below minimum']];
  else if (def.key === 'feedUsage') items = [['Today’s usage', `${num(sum(todayRows(rows), 'quantity'))} kg`, 'Across all sheds'], ['This week', `${num(sum(rows.filter((r) => r.date >= dateOffset(-6)), 'quantity'))} kg`, 'Last 7 days'], ['This month', `${num(sum(currentMonthRows(rows), 'quantity'))} kg`, 'Feed consumed'], ['Feed on hand', `${num(sum(state.feedStock, 'quantity'))} kg`, 'Current stock']];
  else if (def.key === 'feedPurchases') items = [['Purchases this month', money(sum(currentMonthRows(rows), 'totalAmount')), 'Feed expense'], ['Quantity purchased', `${num(sum(currentMonthRows(rows), 'quantity'))} kg`, 'This month'], ['Current feed stock', `${num(sum(state.feedStock, 'quantity'))} kg`, 'Across feed types'], ['Purchase records', rows.length, 'All recorded entries']];
  else if (def.key === 'eggs') items = [['Collected today', num(sum(todayRows(rows), 'totalEggs')), 'All farm sheds'], ['Good eggs today', num(sum(todayRows(rows), 'goodEggs')), 'Recorded as good'], ['This month', num(sum(currentMonthRows(rows), 'totalEggs')), 'Eggs collected'], ['Average lay rate', `${state.sheds.length ? (sum(todayRows(rows), 'totalEggs') / Math.max(sum(state.sheds, 'hens'), 1) * 100).toFixed(1) : '0.0'}%`, 'Today’s eggs / hens']];
  else if (def.key === 'mortality') items = [['Today’s mortality', num(sum(todayRows(rows), 'count')), 'Deaths recorded'], ['This month', num(sum(currentMonthRows(rows), 'count')), 'Bird losses'], ['Sheds reporting', new Set(todayRows(rows).map((r) => r.shed)).size, 'Today'], ['Today’s hens', num(sum(state.sheds, 'hens')), 'All farm sheds']];
  else if (def.key === 'sales') items = [['Trays sold today', num(sum(todayRows(rows), 'trays')), 'Egg tray sales'], ['Sales today', money(sum(todayRows(rows), 'totalAmount')), 'Stored sale prices'], ['This month', money(sum(currentMonthRows(rows), 'totalAmount')), `${num(sum(currentMonthRows(rows), 'trays'))} trays`], ['Pending collection', money(sum(rows.filter((r) => r.paymentStatus !== 'Paid'), 'totalAmount')), 'Pending / partial']];
  else if (def.key === 'expenses') items = [['Today’s spend', money(sum(todayRows(rows), 'amount')), 'All farm expenses'], ['This month', money(sum(currentMonthRows(rows), 'amount')), 'Recorded expenses'], ['Feed spend', money(sum(currentMonthRows(rows).filter((r) => r.category === 'Feed'), 'amount') + sum(currentMonthRows(state.feedPurchases), 'totalAmount')), 'Expense log + purchases'], ['Highest shed spend', highestExpenseShed(), 'This month']];
  else if (def.key === 'sheds') items = [['Total hens', num(sum(rows, 'hens')), 'All farm sheds'], ['Eggs today', num(sum(todayRows(state.eggs), 'totalEggs')), 'All farm sheds'], ['Feed used today', `${num(sum(todayRows(state.feedUsage), 'quantity'))} kg`, 'Daily shed usage'], ['Mortality today', num(sum(todayRows(state.mortality), 'count')), 'Across all sheds']];
  else if (def.key === 'assignments') items = [['Current assignments', rows.filter((r) => !r.endDate).length, 'Active historical links'], ['Workers assigned', new Set(rows.filter((r) => !r.endDate).map((r) => r.worker)).size, 'Unique workers'], ['Sheds covered', new Set(rows.filter((r) => !r.endDate).map((r) => r.shed)).size, 'All farm sheds'], ['History preserved', rows.filter((r) => r.endDate).length, 'Past assignments']];
  else if (def.key === 'dailyWages') items = [['Recorded this month', money(sum(currentMonthRows(rows), 'wage')), 'Daily wage work'], ['Pending payment', money(sum(rows.filter((r) => r.paymentStatus !== 'Paid'), 'wage')), 'Unpaid / partial'], ['Wage records', rows.length, 'All entries'], ['Paid records', rows.filter((r) => r.paymentStatus === 'Paid').length, 'Complete']];
  return `<div class="summary-grid">${items.map(([label, value, noteText]) => `<div class="summary-tile"><div class="summary-label">${esc(label)}</div><div class="summary-value">${value}</div><div class="summary-note">${esc(noteText)}</div></div>`).join('')}</div>`;
}
function payrollDue() {
  const workers = state.workers.filter((worker) => worker.status === 'Active' && worker.salaryType === 'Monthly');
  let amount = 0; let workersDue = 0;
  workers.forEach((worker) => {
    const payments = currentMonthRows(state.payments).filter((payment) => payment.worker === worker.name);
    const paid = sum(payments.filter((payment) => payment.type === 'Salary' && payment.paymentStatus !== 'Pending'), 'amount');
    const advances = sum(payments.filter((payment) => payment.type === 'Advance'), 'amount');
    const bonuses = sum(payments.filter((payment) => payment.type === 'Bonus'), 'amount');
    const deductions = sum(payments.filter((payment) => payment.type === 'Deduction'), 'amount');
    const overtime = sum(currentMonthRows(state.attendance).filter((entry) => String(entry.workerId) === String(worker.id)), 'overtime') * (Number(worker.salary) / 208);
    const due = Math.max(0, Number(worker.salary) + overtime + bonuses - advances - deductions - paid);
    amount += due;
    if (due > 0.01) workersDue += 1;
  });
  return { amount, workersDue };
}
function highestExpenseShed() {
  const totals = shedOptions().map((shed) => [shed, sum(currentMonthRows(state.expenses).filter((row) => row.shed === shed), 'amount')]).sort((a, b) => b[1] - a[1]);
  return totals[0] ? `${totals[0][0]} · ${money(totals[0][1])}` : '—';
}
function filterRows(def, rows) {
  let result = filterByDate(rows, recordDateField(def), ui.dateFrom, ui.dateTo);
  if (ui.search.trim()) {
    const query = ui.search.toLowerCase();
    result = result.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(query)) || (row.workerId && workerName(row.workerId).toLowerCase().includes(query)));
  }
  if (ui.filter !== 'all' && def.filterField) result = result.filter((row) => String(row[def.filterField] ?? '') === ui.filter);
  const sortKey = ui.sort || recordDateField(def) || 'date';
  if (sortKey) result.sort((a, b) => {
    const va = a[sortKey] ?? ''; const vb = b[sortKey] ?? '';
    if (typeof va === 'number' || typeof vb === 'number') return (Number(va) - Number(vb)) * ui.direction;
    return String(va).localeCompare(String(vb)) * ui.direction;
  });
  if (!ui.sort) result.reverse();
  return result;
}
function renderTable(def, rows) {
  const filtered = filterRows(def, rows);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  ui.page = Math.min(ui.page, totalPages);
  const pageRows = filtered.slice((ui.page - 1) * pageSize, ui.page * pageSize);
  const filterOptions = typeof def.filterOptions === 'function' ? def.filterOptions() : def.filterOptions || [];
  const dateField = recordDateField(def);
  const dateLabel = def.columns.find((column) => column.key === dateField)?.label;
  const dateControls = dateField ? `<div class="date-filters" role="group" aria-label="Filter by ${esc(dateLabel)}"><label class="date-filter">From date<input id="dateFrom" type="date" value="${esc(ui.dateFrom)}" ${ui.dateTo ? `max="${esc(ui.dateTo)}"` : ''}></label><label class="date-filter">To date<input id="dateTo" type="date" value="${esc(ui.dateTo)}" ${ui.dateFrom ? `min="${esc(ui.dateFrom)}"` : ''}></label>${ui.dateFrom || ui.dateTo ? '<button class="btn btn-small" data-action="clear-dates">Clear dates</button>' : ''}<span class="date-filter-hint">${esc(dateLabel)}${ui.dateFrom || ui.dateTo ? '' : ' - All dates'}</span></div>` : '';
  const actions = (row) => `<div class="row-actions"><button class="table-action" data-action="view-row" data-id="${esc(row.id)}" title="View details" aria-label="View details">${icon('eye', 13)}</button><button class="table-action" data-action="edit-row" data-id="${esc(row.id)}" title="Edit" aria-label="Edit">${icon('edit', 13)}</button>${def.key === 'workers' ? `<button class="table-action" data-action="worker-attendance" data-id="${esc(row.id)}" title="Attendance">${icon('calendar', 13)}</button><button class="table-action" data-action="worker-payment" data-id="${esc(row.id)}" title="Payments">${icon('wallet', 13)}</button>` : ''}${['assignments'].includes(def.key) ? '' : `<button class="table-action danger" data-action="delete-row" data-id="${esc(row.id)}" title="Delete" aria-label="Delete">${icon('trash', 13)}</button>`}</div>`;
  return `<div class="module-toolbar"><label class="search-box">${icon('search', 14)}<input id="moduleSearch" type="search" placeholder="Search ${esc(def.title.toLowerCase())}…" value="${esc(ui.search)}" aria-label="Search ${esc(def.title)}"></label>${filterOptions.length ? `<select class="filter-select" id="moduleFilter" aria-label="Filter by ${esc(def.filterField)}"><option value="all">${esc(def.filterLabel || 'All')}</option>${filterOptions.map((option) => `<option value="${esc(option)}" ${ui.filter === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>` : ''}${dateControls}<div class="results-label">${filtered.length} record${filtered.length === 1 ? '' : 's'}</div></div>
    <div class="module-card"><div class="table-wrap"><table class="data-table"><thead><tr>${def.columns.map((column) => `<th><span class="th-sort" data-action="sort" data-key="${esc(column.key)}">${esc(column.label)}${ui.sort === column.key ? (ui.direction > 0 ? ' ↑' : ' ↓') : ''}</span></th>`).join('')}<th>Actions</th></tr></thead><tbody>${pageRows.length ? pageRows.map((row) => `<tr>${def.columns.map((column) => `<td>${formatCell(column, row)}</td>`).join('')}<td>${actions(row)}</td></tr>`).join('') : `<tr><td colspan="${def.columns.length + 1}" class="table-empty">No records match this search. Try a different filter or add a new record.</td></tr>`}</tbody></table></div><div class="pagination"><span>Showing ${filtered.length ? (ui.page - 1) * pageSize + 1 : 0}–${Math.min(ui.page * pageSize, filtered.length)} of ${filtered.length}</span><div class="page-actions"><button class="page-btn" data-action="page" data-step="-1" ${ui.page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button><span class="page-btn" style="display:grid;place-items:center;color:var(--green)">${ui.page}</span><button class="page-btn" data-action="page" data-step="1" ${ui.page >= totalPages ? 'disabled' : ''} aria-label="Next page">›</button></div></div></div>`;
}
function renderModule() {
  const def = modules[ui.view];
  const primary = def.addLabel ? `<button class="btn btn-primary" data-action="new-row">${icon('plus', 14)}${esc(def.addLabel)}</button>` : ''; 
  const title = pageHeading(def.title, def.subtitle, `<div class="date-chip">${icon('calendar', 14)}${prettyDate(today, { weekday: 'short', day: 'numeric', month: 'short' })}</div>${primary}`);
  return `${connectionBanner()}${title}${summaryTiles(def)}${renderTable(def, state[def.key] || [])}`;
}
function renderAccount() {
  if (!ui.session) {
    return `${connectionBanner()}${pageHeading('My Account', 'Sign in to manage your account.')}<div class="settings-grid"><section class="settings-card"><h3>Not signed in</h3><p>You need to sign in before you can change your account details.</p><button class="btn btn-primary" data-action="sign-in">Sign in</button></section></div>`;
  }
  return `${connectionBanner()}${pageHeading('My Account', 'Update your name, email address, and password.')}
  <div class="settings-grid">
    <section class="settings-card">
      <h3>Account details</h3>
      <p>Your name and email are used for login and appear across the app.</p>
      <form id="accountForm" novalidate>
        <div class="form-field">
          <label for="acc-name">Full name <span style="font-weight:normal;color:var(--muted)">(required)</span></label>
          <input id="acc-name" name="name" type="text" value="${esc(ui.session.name)}" required>
          <span class="form-error" data-error="name"></span>
        </div>
        <div class="form-field">
          <label for="acc-email">Email address <span style="font-weight:normal;color:var(--muted)">(required)</span></label>
          <input id="acc-email" name="email" type="email" value="${esc(ui.session.email)}" required>
          <span class="form-error" data-error="email"></span>
        </div>
        <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
        <p style="color:var(--muted);font-size:0.88rem;margin:0 0 10px">Leave the password fields empty if you do not want to change your password.</p>
        <div class="form-field">
          <label for="acc-current-pw">Current password</label>
          <input id="acc-current-pw" name="currentPassword" type="password" placeholder="Required only if changing password" autocomplete="current-password">
          <span class="form-error" data-error="currentPassword"></span>
        </div>
        <div class="form-field">
          <label for="acc-new-pw">New password</label>
          <input id="acc-new-pw" name="newPassword" type="password" placeholder="Minimum 8 characters" autocomplete="new-password">
          <span class="form-error" data-error="newPassword"></span>
        </div>
        <div class="form-field">
          <label for="acc-confirm-pw">Confirm new password</label>
          <input id="acc-confirm-pw" name="confirmPassword" type="password" placeholder="Repeat new password" autocomplete="new-password">
          <span class="form-error" data-error="confirmPassword"></span>
        </div>
        <div class="form-error" data-error="general"></div>
        <div class="settings-actions">
          <button class="btn btn-primary" type="submit">Save changes</button>
        </div>
      </form>
    </section>
    <section class="settings-card">
      <h3>Current session</h3>
      <div class="callout">
        <b>Name:</b> ${esc(ui.session.name)}<br>
        <b>Email:</b> ${esc(ui.session.email)}<br>
        <b>Role:</b> ${esc(ui.session.role)}<br>
        <b>Account ID:</b> <span style="font-size:0.82rem;color:var(--muted)">${esc(ui.session.id)}</span>
      </div>
      <div class="feature-note" style="margin-top:12px">If you change your password, you will be signed out of all devices and must sign in again with the new password.</div>
      <div class="settings-actions" style="margin-top:14px">
        <button class="btn btn-quiet" data-action="sign-out">Sign out</button>
      </div>
    </section>
  </div>`;
}


function renderSettings() {
  const settings = state.settings || {};
  const title = pageHeading('Farm settings', 'Manage your account and shared farm profile.');
  const accessPanel = ui.session
    ? `<div class="callout"><b>Signed in:</b> ${esc(ui.session.name || 'Farm user')}<br><b>Email:</b> ${esc(ui.session.email || '—')}<br><b>Role:</b> ${esc(ui.session.role || 'staff')}</div><button class="btn btn-quiet" data-action="sign-out">Sign out</button>`
    : `<div class="callout">Sign in to view and manage your farm records.</div><button class="btn btn-primary" data-action="sign-in">Sign in</button>`;
  const databaseStatus = ui.apiHealth?.database ? 'Connected · PostgreSQL database' : 'Not checked';
  return `${connectionBanner()}${title}<div class="settings-grid"><section class="settings-card"><h3>Account access</h3><p>NestLedger uses its own email/password authentication. No third-party account is required.</p>${accessPanel}</section><section class="settings-card"><h3>Data connection</h3><p>Signed-in changes are stored in the shared PostgreSQL farm database.</p><div class="callout"><b>Current mode:</b> ${isRemoteConnected() ? 'Signed in · Shared PostgreSQL database' : 'Signed out - Sign in required'}<br><b>Data store:</b> ${databaseStatus}<br><b>API:</b> Same-origin Express API</div><div class="settings-actions"><button class="btn btn-quiet" data-action="check-api">Check connection</button></div></section><section class="settings-card"><h3>Farm profile</h3><p>These details appear across the dashboard and in the sidebar.</p><form id="settingsForm" class="settings-form"><div class="form-field"><label for="farmName">Farm name</label><input id="farmName" name="farmName" value="${esc(settings.farmName)}" required></div><div class="form-field"><label for="owner">Owner / administrator <span style="font-weight:normal;color:var(--muted)">(optional)</span></label><input id="owner" name="owner" value="${esc(settings.owner)}"></div><div class="form-field"><label for="phone">Contact phone</label><input id="phone" name="phone" value="${esc(settings.phone)}"></div><div class="form-field"><label for="address">Farm location</label><input id="address" name="address" value="${esc(settings.address)}"></div><div class="settings-actions"><button class="btn btn-primary" type="submit">Save settings</button></div></form></section><section class="settings-card"><h3>Farm structure</h3><div class="settings-actions"><button class="btn btn-primary" data-action="add-shed">Add shed</button><button class="btn" data-action="navigate" data-view="sheds">Manage sheds</button></div><p>Add as many sheds as your farm needs. Rename sheds or update hen counts in Shed overview.</p><div class="callout">${state.sheds.map((shed) => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${esc(shed.name)}</span><b>${num(shed.hens)} hens</b><button class="table-action danger" data-action="delete-shed" data-id="${shed.id}" aria-label="Delete shed">${icon('trash', 13)}</button></div>`).join('')}</div><div class="feature-note">Egg production, mortality, feed usage, workers, and expenses are associated with these sheds.</div></section></div>`;
}

function render() {
  const app = $('#app');
  const content = ui.view.startsWith('dashboard-shed-') ? renderShedDashboard(ui.view.split('-').pop()) : ui.view === 'dashboard' ? renderDashboard() : ui.view === 'settings' ? renderSettings() : ui.view === 'account' ? renderAccount() : modules[ui.view] ? renderModule() : renderDashboard();

  app.innerHTML = `<div class="layout">${renderSidebar()}<div class="workspace">${renderTopbar()}<main class="main">${ui.view.startsWith('dashboard') ? dashboardTabs() : ''}${content}</main></div></div>`;
}

function fieldOptions(field) {
  const options = typeof field.options === 'function' ? field.options() : field.options || [];
  return options.map((option) => typeof option === 'object' ? option : ({ value: option, label: option }));
}
function openModal({ title, subtitle, fields, values = {}, onSubmit, detail = false, submitLabel = 'Save record' }) {
  const root = $('#modal-root');
  const body = detail ? `<div class="form-grid">${fields.map((field) => `<div class="form-field ${field.full ? 'full' : ''}"><label>${esc(field.label)}</label><div class="callout" style="margin:0">${esc(typeof values[field.key] === 'object' ? JSON.stringify(values[field.key]) : values[field.key] || '—')}</div></div>`).join('')}</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Close</button></div>` : `<form id="recordForm" novalidate><div class="form-grid">${fields.map((field) => {
    const current = values[field.key] ?? (field.key === 'date' || field.type === 'date' ? today : field.type === 'select' ? fieldOptions(field)[0]?.value || '' : '');
    const required = field.required ? '<span class="required-mark"> *</span>' : '';
    let input;
    if (field.type === 'select') {
      input = `<select id="field-${field.key}" name="${field.key}" ${field.required ? 'required' : ''}>${fieldOptions(field).map((option) => `<option value="${esc(option.value)}" ${String(current) === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>`;
    } else if (field.type === 'textarea') {
      input = `<textarea id="field-${field.key}" name="${field.key}" placeholder="${esc(field.placeholder || '')}">${esc(current)}</textarea>`;
    } else {
      input = `<input id="field-${field.key}" name="${field.key}" type="${field.type || 'text'}" value="${esc(current)}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.step ? `step="${field.step}"` : ''} ${field.required ? 'required' : ''} ${field.placeholder ? `placeholder="${esc(field.placeholder)}"` : ''}>`;
    }
    return `<div class="form-field ${field.full ? 'full' : ''}"><label for="field-${field.key}">${esc(field.label)}${required}</label>${input}<span class="form-error" data-error="${field.key}"></span></div>`;
  }).join('')}</div><div class="form-error" data-error="general"></div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${esc(submitLabel)}</button></div></form>`;
  root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><div class="modal-title" id="modalTitle">${esc(title)}</div><div class="modal-sub">${esc(subtitle || '')}</div></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">${icon('close', 16)}</button></div><div class="modal-body">${body}</div></section></div>`;
  if (onSubmit) $('#recordForm', root)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await onSubmit(event.currentTarget); }
    catch (error) {
      if (error?.status === 401) {
        closeModal();
        ui.session = null;
        render();
        showToast('Your session has expired. Please sign in again.', 'warning');
        openAuthModal('login');
        return;
      }
      const msg = error?.message || 'The record could not be saved.';
      showToast(msg, 'error');
      setFormError(event.currentTarget, 'general', msg);
    }
  });
  $('.modal-backdrop', root)?.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal(); });
  $('input,select,textarea', root)?.focus();
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function showToast(message, type = '') {
  const root = $('#toast-root'); const toast = document.createElement('div');
  toast.className = `toast ${type}`; toast.textContent = message; root.appendChild(toast);
  window.setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(5px)'; window.setTimeout(() => toast.remove(), 180); }, 2800);
}
function setFormError(form, field, message) {
  const target = $(`[data-error="${field}"]`, form);
  if (target) target.textContent = message;
}
function validateRecord(form, def, body, existingId) {
  let valid = true;
  for (const field of def.fields) {
    const value = body[field.key];
    if (field.required && (value === '' || value === null || value === undefined)) { setFormError(form, field.key, `${field.label} is required.`); valid = false; }
    if (field.type === 'number' && value !== '' && Number(value) < 0) { setFormError(form, field.key, 'Value cannot be negative.'); valid = false; }
  }
  if (def.key === 'eggs' && Number(body.goodEggs) + Number(body.brokenEggs) > Number(body.totalEggs)) { setFormError(form, 'general', 'Good eggs plus broken eggs cannot exceed the total eggs.'); valid = false; }
  if (def.key === 'attendance' && state.attendance.some((item) => String(item.id) !== String(existingId) && String(item.workerId) === String(body.workerId) && item.date === body.date)) { setFormError(form, 'general', 'Attendance already exists for this worker and date.'); valid = false; }
  if (def.key === 'sheds' && state.sheds.some((shed) => String(shed.id) !== String(existingId) && shed.name.toLowerCase() === String(body.name).trim().toLowerCase())) { setFormError(form, 'name', 'A shed with this name already exists.'); valid = false; }
  return valid;
}
function createRecordId(key) {
  const prefixes = { workers: 'WK', attendance: 'AT', payments: 'PY', feedStock: 'FD', feedUsage: 'FU', feedPurchases: 'FP', eggs: 'EG', mortality: 'MO', sales: 'SL', expenses: 'EX', sheds: 'SH', assignments: 'AS', dailyWages: 'DW' };
  return `${prefixes[key] || 'ID'}-${Date.now().toString().slice(-7)}`;
}
async function openRecordForm(def, existing = null) {
  openModal({ title: existing ? `Edit ${def.singular}` : def.addLabel, subtitle: existing ? `Update details for ${existing.name || existing.id || def.singular}.` : `Required fields are marked with an asterisk.`, fields: def.fields, values: existing || {}, submitLabel: existing ? 'Save changes' : 'Save record', onSubmit: async (form) => {
    const raw = Object.fromEntries(new FormData(form).entries());
    const body = {};
    def.fields.forEach((field) => {
      let value = raw[field.key] ?? '';
      if (field.type === 'number') value = value === '' ? 0 : Number(value);
      body[field.key] = value;
    });
    if (def.key === 'attendance') {
      body.worker = workerName(body.workerId);
      if (body.checkIn && body.checkOut) {
        const [ih, im] = String(body.checkIn).split(':').map(Number);
        const [oh, om] = String(body.checkOut).split(':').map(Number);
        let hours = (oh * 60 + om - (ih * 60 + im)) / 60;
        if (hours < 0) hours += 24;
        body.workingHours = Math.round(hours * 100) / 100;
      } else {
        body.workingHours = 0;
      }
      if (body.status === 'Present' && !body.checkIn) { setFormError(form, 'checkIn', 'Add a check-in time for a present worker.'); return; }
    }
    if (def.key === 'sales') body.totalAmount = Number(body.trays) * Number(body.pricePerTray);
    if (def.key === 'feedPurchases') body.totalAmount = Number(body.quantity) * Number(body.rate);
    if (def.key === 'feedStock') body.updated = body.updated || today;
    if (def.key === 'payments' && !body.recordedBy) body.recordedBy = ui.session?.name || state.settings?.owner || 'Farm Admin';
    if (def.key === 'payments' && !body.paymentStatus) body.paymentStatus = 'Paid';
    if (def.key === 'expenses' && !body.addedBy) body.addedBy = ui.session?.name || state.settings?.owner || 'Farm Admin';
    if (def.key === 'workers' && !body.id) body.id = createRecordId('workers');
    if (!validateRecord(form, def, body, existing?.id)) return;
    const id = existing?.id || body.id || createRecordId(def.key);
    body.id = id;
    if (existing) {
      const previousCopy = { ...existing };
      const remoteRow = await saveResource(def.endpoint, def.key, 'PUT', body, id);
      const saved = remoteRow && typeof remoteRow === 'object' ? { ...body, ...remoteRow, id } : body;
      if (def.key === 'workers') {
        const workerIndex = state.workers.findIndex((worker) => String(worker.id) === String(id));
        if (workerIndex >= 0) {
          const previous = state.workers[workerIndex];
          if (previous.assignedShed !== saved.assignedShed) {
            const activeAssignment = state.assignments.find((item) => item.worker === previous.name && !item.endDate);
            if (activeAssignment) activeAssignment.endDate = today;
            state.assignments.unshift({ id: createRecordId('assignments'), worker: saved.name, shed: saved.assignedShed, startDate: today, endDate: '', reason: 'Shed reassignment' });
          }
          state.workers[workerIndex] = { ...previous, ...saved };
        }
      } else if (def.key !== 'sheds') {
        const index = state[def.key].findIndex((row) => String(row.id) === String(id));
        if (index >= 0) state[def.key][index] = { ...state[def.key][index], ...saved };
      } else {
        const index = state.sheds.findIndex((row) => String(row.id) === String(id));
        if (index >= 0) state.sheds[index] = { ...state.sheds[index], ...saved };
      }
      if (def.key === 'feedUsage') {
        if (previousCopy.feedType !== saved.feedType) updateLocalStock(previousCopy.feedType, Number(previousCopy.quantity));
        updateLocalStock(saved.feedType, -Number(saved.quantity) + (previousCopy.feedType === saved.feedType ? Number(previousCopy.quantity) : 0));
      }
      if (def.key === 'feedPurchases') {
        if (previousCopy.feedType !== saved.feedType) updateLocalStock(previousCopy.feedType, -Number(previousCopy.quantity));
        updateLocalStock(saved.feedType, Number(saved.quantity) - (previousCopy.feedType === saved.feedType ? Number(previousCopy.quantity) : 0));
      }
      if (def.key === 'sheds') await refreshResources();
      persistLocal(state);
      showToast(`${titleCase(def.singular)} updated.`);
    } else {
      const remoteRow = await saveResource(def.endpoint, def.key, 'POST', body);
      const saved = remoteRow && typeof remoteRow === 'object' ? remoteRow : body;
      const list = state[def.key] || (state[def.key] = []);
      list.unshift(saved);
      if (def.key === 'workers') state.assignments.unshift({ id: createRecordId('assignments'), worker: saved.name, shed: saved.assignedShed, startDate: saved.joiningDate || today, endDate: '', reason: 'Initial assignment' });
      if (def.key === 'feedPurchases') updateLocalStock(saved.feedType, Number(saved.quantity));
      if (def.key === 'feedUsage') updateLocalStock(saved.feedType, -Number(saved.quantity));
      persistLocal(state);
      showToast(`${titleCase(def.singular)} saved.`);
    }
    persistLocal(state);
    closeModal(); ui.page = 1; render();
  } });
}
function updateLocalStock(feedName, delta) {
  const record = state.feedStock.find((item) => item.name === feedName);
  if (record) record.quantity = Math.max(0, Number(record.quantity) + delta);
}
function detailModal(def, record) {
  const fields = def.fields.map((field) => ({ ...field, label: field.label }));
  const values = { ...record };
  if (def.key === 'attendance') values.workerId = `${workerName(record.workerId)} · ${record.workerId}`;
  openModal({ title: `${titleCase(def.singular)} details`, subtitle: record.name || record.worker || record.id, fields, values, detail: true });
}
function removeRecord(def, id) {
  const record = (state[def.key] || []).find((item) => String(item.id) === String(id));
  if (!record) return;
  const label = record.name || record.worker || record.id;
  if (def.key === 'sheds') {
    const linked = state.workers.some((row) => row.assignedShed === record.name) || ['assignments', 'dailyWages', 'feedUsage', 'eggs', 'mortality', 'expenses'].some((key) => state[key].some((row) => row.shed === record.name));
    if (linked) { showToast('This shed has linked workers or farm records. Move or remove those records first.', 'error'); return; }
  }
  openModal({ title: `Delete ${def.singular}?`, subtitle: def.key === 'workers' ? `Remove ${label} from the worker list? Attendance and payment history will be retained.` : `Confirm removal of ${label}. This action cannot be undone.`, fields: [], values: {}, detail: true, onSubmit: null });
  const actions = $('.form-actions', $('#modal-root'));
  actions.innerHTML = `<button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn btn-danger" type="button" data-action="confirm-delete" data-id="${esc(id)}">Delete record</button>`;
  $('#modal-root').dataset.deleteModule = def.key;
}
async function confirmDelete(id) {
  const key = $('#modal-root').dataset.deleteModule;
  const def = modules[key];
  if (!def) return closeModal();
    const deletedRow = state[key].find((row) => String(row.id) === String(id));
    await tryRemoteDelete(def.endpoint, id);
    if (key === 'feedUsage' && deletedRow) updateLocalStock(deletedRow.feedType, Number(deletedRow.quantity));
    if (key === 'feedPurchases' && deletedRow) updateLocalStock(deletedRow.feedType, -Number(deletedRow.quantity));
    state[key] = (state[key] || []).filter((row) => String(row.id) !== String(id));
    persistLocal(state);
    if (key === 'sheds') { ui.filter = 'all'; ui.page = 1; }
    if (key === 'workers') await refreshResources();
    showToast(key === 'workers' ? 'Worker removed from the list. Attendance and payment history are retained.' : `${titleCase(def.singular)} deleted.`);
  closeModal(); render();
}
function openQuickEntry() {
  openModal({ title: 'Quick entry', subtitle: 'Choose a common daily record to add.', fields: [{ key: 'entryType', label: 'Record type', type: 'select', required: true, options: [{ value: 'eggs', label: 'Egg production' }, { value: 'mortality', label: 'Mortality' }, { value: 'sales', label: 'Tray sale' }, { value: 'expenses', label: 'Daily expense' }, { value: 'feedUsage', label: 'Feed usage' }, { value: 'attendance', label: 'Worker attendance' }] }], values: { entryType: 'eggs' }, submitLabel: 'Continue', onSubmit: async (form) => { const target = new FormData(form).get('entryType'); closeModal(); ui.view = target; ui.search = ''; ui.filter = 'all'; render(); await openRecordForm(modules[target]); } });
}
function openAuthModal(mode = 'login') {
  let currentMode = mode;
  const renderAuth = () => {
    const isLogin = currentMode === 'login';
    openModal({
      title: isLogin ? 'Sign in to NestLedger' : 'Create your farm account',
      subtitle: isLogin ? 'Sign in to access your shared PostgreSQL farm database.' : 'Create a staff account for this farm.',
      fields: isLogin
        ? [text('email', 'Email', true), { key: 'password', label: 'Password', type: 'password', required: true }]
        : [text('name', 'Full name'), text('email', 'Email'), { key: 'password', label: 'Password', type: 'password', required: true, placeholder: 'Minimum 8 characters' }],
      values: {},
      submitLabel: isLogin ? 'Sign in' : 'Create account',
      onSubmit: async (form) => {
        const values = Object.fromEntries(new FormData(form).entries());
        const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(values) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success !== true) throw new Error(payload.message || 'Authentication failed.');
        clearDemoStorage();
        closeModal();
        await refreshSession();
        await refreshApiHealth();
        await refreshResources();
        render();
        showToast(isLogin ? 'Signed in successfully.' : 'Account created successfully.');
      },
    });
    const actions = $('.form-actions', modalRoot);
    if (actions) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn btn-quiet';
      toggle.textContent = isLogin ? 'Create account' : 'Back to sign in';
      toggle.addEventListener('click', () => { currentMode = isLogin ? 'register' : 'login'; renderAuth(); });
      actions.insertBefore(toggle, actions.firstChild);

    }
  };
  renderAuth();
}

function navigate(view) {
  ui.view = view; ui.search = ''; ui.filter = 'all'; ui.dateFrom = ''; ui.dateTo = ''; ui.page = 1; ui.sort = ''; ui.notifications = false; ui.mobileOpen = false; render();
}

const app = $('#app');
const modalRoot = $('#modal-root');
app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'sign-in') { return openAuthModal('login'); }
  if (action === 'sign-out') {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    try { sessionStorage.removeItem('nestledger.apiToken'); } catch {}
    ui.session = null; ui.apiHealth = null; clearRemoteData(); render(); showToast('Signed out.'); return;
  }
  if (action === 'shed-records') { navigate(target.dataset.view); ui.filter = target.dataset.shed; render(); return; }
  if (action === 'navigate') return navigate(target.dataset.view);
  if (action === 'toggle-menu') { ui.mobileOpen = !ui.mobileOpen; render(); return; }
  if (action === 'close-menu') { ui.mobileOpen = false; render(); return; }
  if (action === 'notifications') { ui.notifications = !ui.notifications; render(); return; }
  if (action === 'clear-dates') { ui.dateFrom = ''; ui.dateTo = ''; ui.page = 1; render(); return; }
  if (action === 'range') { ui.range = Number(target.dataset.range); render(); return; }
  if (action === 'quick-entry') return openQuickEntry();
  if (action === 'delete-shed') return removeRecord(modules.sheds, target.dataset.id);
  if (action === 'add-shed') return openRecordForm(modules.sheds);
  if (action === 'new-row') return openRecordForm(modules[ui.view]);
  if (action === 'edit-shed') return openRecordForm(modules.sheds, state.sheds.find((row) => String(row.id) === target.dataset.id));
  if (action === 'close-modal') return closeModal();
  if (action === 'backdrop') { if (event.target === target) closeModal(); return; }
  if (action === 'page') { ui.page += Number(target.dataset.step); render(); return; }
  if (action === 'sort') { const key = target.dataset.key; ui.direction = ui.sort === key ? -ui.direction : 1; ui.sort = key; render(); return; }
  if (action === 'view-row' || action === 'edit-row' || action === 'delete-row') {
    const def = modules[ui.view]; const record = state[def.key].find((row) => String(row.id) === target.dataset.id);
    if (!record) return;
    if (action === 'view-row') detailModal(def, record);
    if (action === 'edit-row') openRecordForm(def, record);
    if (action === 'delete-row') removeRecord(def, record.id);
    return;
  }
  if (action === 'confirm-delete') return confirmDelete(target.dataset.id);
  if (action === 'worker-attendance' || action === 'worker-payment') {
    const worker = state.workers.find((row) => String(row.id) === target.dataset.id);
    navigate(action === 'worker-attendance' ? 'attendance' : 'payments');
    ui.search = worker?.name || ''; render(); return;
  }
  if (action === 'check-api') {
    const health = await refreshApiHealth();
    if (health?.database) showToast('PostgreSQL farm database is connected.');
    else showToast('Database unreachable. Check connection settings.', 'error');
    render();
    return;
  }
});
app.addEventListener('input', (event) => {
  if (event.target.id === 'globalSearch' || event.target.id === 'moduleSearch') {
    ui.search = event.target.value; ui.page = 1;
    if ((event.target.id === 'globalSearch' && ui.view !== 'dashboard' && ui.view !== 'settings') || event.target.id === 'moduleSearch') {
      const inputId = event.target.id; const cursor = event.target.selectionStart; render();
      const nextInput = $(`#${inputId}`); if (nextInput) { nextInput.focus(); try { nextInput.setSelectionRange(cursor, cursor); } catch {} }
    }
  }
});
app.addEventListener('change', (event) => {
  if (event.target.id === 'languageSwitch') { setLanguage(event.target.value); render(); translateUI(app); return; }
  if (event.target.id === 'dateFrom' || event.target.id === 'dateTo') {
    const from = event.target.id === 'dateFrom' ? event.target.value : ui.dateFrom;
    const to = event.target.id === 'dateTo' ? event.target.value : ui.dateTo;
    if (from && to && from > to) {
      showToast('From date must be on or before To date.', 'error');
      event.target.value = event.target.id === 'dateFrom' ? ui.dateFrom : ui.dateTo;
      return;
    }
    ui.dateFrom = from; ui.dateTo = to; ui.page = 1; render(); return;
  }
  if (event.target.id === 'moduleFilter') { ui.filter = event.target.value; ui.page = 1; render(); }
});
modalRoot.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'close-modal') closeModal();
  if (target.dataset.action === 'confirm-delete') {
    try { await confirmDelete(target.dataset.id); }
    catch (error) { showToast(error?.message || 'The record could not be deleted.', 'error'); }
  }

});
app.addEventListener('submit', async (event) => {
  if (event.target.id === 'accountForm') {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form).entries());
    // Clear previous errors
    $$('[data-error]', form).forEach((el) => { el.textContent = ''; });
    if (!data.name.trim()) { const el = $('[data-error="name"]', form); if (el) el.textContent = 'Name is required.'; return; }
    if (!data.email.trim()) { const el = $('[data-error="email"]', form); if (el) el.textContent = 'Email is required.'; return; }
    if (data.newPassword && data.newPassword !== data.confirmPassword) { const el = $('[data-error="confirmPassword"]', form); if (el) el.textContent = 'Passwords do not match.'; return; }
    if (data.newPassword && data.newPassword.length < 8) { const el = $('[data-error="newPassword"]', form); if (el) el.textContent = 'Must be at least 8 characters.'; return; }
    try {
      const payload = { name: data.name.trim(), email: data.email.trim() };
      if (data.newPassword) { payload.currentPassword = data.currentPassword; payload.newPassword = data.newPassword; }
      const response = await fetch('/api/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) {
        const errEl = $('[data-error="general"]', form);
        if (errEl) errEl.textContent = result.message || 'Could not save changes.';
        showToast(result.message || 'Could not save changes.', 'error');
        return;
      }
      ui.session = { ...ui.session, ...result.data };
      showToast('Account updated successfully.');
      if (data.newPassword) {
        showToast('Password changed. Please sign in again.', 'warning');
        setTimeout(async () => {
          try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
          ui.session = null; clearRemoteData(); render(); openAuthModal('login');
        }, 1500);
      } else {
        render();
      }
    } catch (err) {
      showToast(err?.message || 'Something went wrong.', 'error');
    }
    return;
  }
  if (event.target.id === 'settingsForm') {

    event.preventDefault();
    if (!ui.session) { openAuthModal('login'); return; }
    const form = new FormData(event.target);
    state.settings = {
      ...state.settings,
      farmName: form.get('farmName').trim(),
      owner: form.get('owner').trim(),
      phone: form.get('phone').trim(),
      address: form.get('address').trim(),
    };
    if (isRemoteConnected()) {
      try {
        const saved = await saveRemoteSettings(state.settings);
        if (saved) state.settings = { ...state.settings, ...saved };
        showToast('Farm settings saved to database.');
      } catch (err) {
        if (err?.status === 401) {
          ui.session = null;
          render();
          showToast('Session expired. Please sign in again.', 'warning');
          openAuthModal('login');
          return;
        }
        showToast(err?.message || 'Farm profile could not be saved to the database.', 'error');
      }
    } else {
      showToast('Sign in to save farm settings.', 'warning');
      openAuthModal('login');
    }
    await refreshResources();
    await refreshApiHealth();
    render();
  }
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });

async function boot() {
  render();
  try {
    await Promise.all([refreshSession(), refreshApiHealth()]);
    await refreshResources();
  } catch (error) {
    if (error?.status === 401) {
      ui.session = null;
      showToast('Your session has expired. Please sign in again.', 'warning');
      openAuthModal('login');
    }
  }
  if (!state.sheds || !state.sheds.length) state.sheds = createEmptyData().sheds;
  if (!isRemoteConnected()) persistLocal(state);
  render();
}
watchTranslations();
boot();
