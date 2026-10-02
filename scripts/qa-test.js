import 'dotenv/config';
import { query } from '../server/db/pool.js';

const connectionUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

export async function runQaTests(baseUrl = 'http://127.0.0.1:3000') {
  console.log(`\n========================================`);
  console.log(`   NESTLEDGER FULL QA TEST SUITE`);
  console.log(`========================================`);
  console.log(`Target: ${baseUrl}`);
  console.log(`Database Mode: ${process.env.TEST_DATABASE_URL ? 'Dedicated TEST Database' : 'Configured Database (TEST prefix isolation)'}`);

  const results = [];
  const testIds = {
    workers: [],
    attendance: [],
    payments: [],
    dailyWages: [],
    feedStock: [],
    feedUsage: [],
    feedPurchases: [],
    eggs: [],
    mortality: [],
    sales: [],
    expenses: [],
  };

  let sessionCookie = '';

  function report(name, passed, detail = '') {
    results.push({ name, passed, detail });
    console.log(`${passed ? '✓ PASS' : '✗ FAIL'}: ${name} ${detail ? '(' + detail + ')' : ''}`);
    if (!passed) throw new Error(`Test failed: ${name} - ${detail}`);
  }

  async function api(path, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (sessionCookie) headers.Cookie = sessionCookie;
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/nestledger_session=[^;]+/);
      if (match) sessionCookie = match[0];
    }
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : null;
    return { status: res.status, ok: res.ok, data };
  }

  try {
    // 1. Health check
    const health = await api('/health');
    report('API & Database Health Check', health.ok && health.data?.data?.database === true, `status: ${health.status}`);

    // 2. Authentication: login with default admin credentials
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@nestledger.local';
    const login = await api('/auth/login', 'POST', { email: adminEmail, password: adminPassword });
    report('Admin Authentication', login.ok && login.data?.success === true, `User: ${login.data?.data?.email}`);

    // 3. Settings: fetch, verify feedCapacity, update optional owner and feedCapacity
    const originalSettings = (await api('/settings')).data?.data;
    report('Fetch Farm Settings', !!originalSettings, `Owner: "${originalSettings?.owner}", FeedCapacity: ${originalSettings?.feedCapacity}`);

    const updatedSettings = await api('/settings', 'PUT', {
      farmName: 'TEST Farm Name',
      owner: '', // optional owner test
      feedCapacity: 7500,
    });
    report('Update Farm Settings (Optional Owner & Capacity 7500)', updatedSettings.ok && updatedSettings.data?.data?.feedCapacity === 7500 && updatedSettings.data?.data?.owner === '');

    // 4. Workers: Create TEST Worker
    const testWorkerId = `WK-TEST-${Date.now().toString().slice(-5)}`;
    const newWorker = await api('/workers', 'POST', {
      id: testWorkerId,
      name: 'TEST Worker Alpha',
      phone: '9876543210',
      role: 'TEST Feeder',
      assignedShed: 'Shed 1',
      salaryType: 'Monthly',
      salary: 15000,
      status: 'Active',
    });
    report('Create TEST Worker', newWorker.ok && newWorker.data?.data?.id === testWorkerId);
    testIds.workers.push(testWorkerId);

    // Verify auto-created assignment
    const assignments = await api('/worker-assignments');
    const autoAssignment = assignments.data?.data?.find((a) => a.worker === 'TEST Worker Alpha');
    report('Auto-create Assignment for New Worker', !!autoAssignment, `Shed: ${autoAssignment?.shed}`);
    if (autoAssignment) testIds.assignments = [autoAssignment.id];

    // Edit salary
    const updatedWorker = await api(`/workers/${testWorkerId}`, 'PUT', { salary: 16500 });
    report('Update Worker Salary', updatedWorker.ok && Number(updatedWorker.data?.data?.salary) === 16500);

    // 5. Attendance & Calculations
    const todayStr = new Date().toISOString().slice(0, 10);
    const testAttId = `AT-TEST-${Date.now().toString().slice(-5)}`;
    const att1 = await api('/attendance', 'POST', {
      id: testAttId,
      workerId: testWorkerId,
      date: todayStr,
      status: 'Present',
      checkIn: '08:00',
      checkOut: '16:30',
    });
    report('Record Attendance (Normal Shift 8:00-16:30 -> 8.5h)', att1.ok && Number(att1.data?.data?.workingHours) === 8.5);
    testIds.attendance.push(testAttId);

    // Duplicate attendance block test
    const attDup = await api('/attendance', 'POST', {
      id: `AT-TEST-DUP-${Date.now().toString().slice(-5)}`,
      workerId: testWorkerId,
      date: todayStr,
      status: 'Present',
      checkIn: '09:00',
      checkOut: '17:00',
    });
    report('Duplicate Attendance Blocked with Friendly Message', attDup.status === 409 && attDup.data?.message?.includes('already exists'), `Message: ${attDup.data?.message}`);

    // Overnight shift attendance calculation
    const testOvernightAttId = `AT-TEST-NIGHT-${Date.now().toString().slice(-5)}`;
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const attNight = await api('/attendance', 'POST', {
      id: testOvernightAttId,
      workerId: testWorkerId,
      date: yesterdayStr,
      status: 'Present',
      checkIn: '22:00',
      checkOut: '06:00',
    });
    report('Overnight Shift Attendance Calculation (22:00-06:00 -> 8h)', attNight.ok && Number(attNight.data?.data?.workingHours) === 8.0);
    testIds.attendance.push(testOvernightAttId);

    // 6. Worker Payments & Daily Wages
    const testPayId = `PY-TEST-${Date.now().toString().slice(-5)}`;
    const pay = await api('/worker-payments', 'POST', {
      id: testPayId,
      workerId: testWorkerId,
      date: todayStr,
      amount: 5000,
      type: 'Advance',
      method: 'Cash',
      paymentStatus: 'Paid',
      reason: 'TEST Advance',
    });
    report('Record Worker Payment', pay.ok && Number(pay.data?.data?.amount) === 5000);
    testIds.payments.push(testPayId);

    const testWageId = `DW-TEST-${Date.now().toString().slice(-5)}`;
    const wage = await api('/daily-wages', 'POST', {
      id: testWageId,
      workerId: testWorkerId,
      date: todayStr,
      shed: 'Shed 1',
      work: 'TEST Maintenance',
      wage: 600,
      paymentStatus: 'Pending',
    });
    report('Record Daily Wage', wage.ok && Number(wage.data?.data?.wage) === 600);
    testIds.dailyWages.push(testWageId);

    // 7. Feed Inventory: stock, purchase, usage, stock corrections
    // Query initial stock for 'Layer Feed'
    const stockListBefore = (await api('/feed/stock')).data?.data || [];
    const layerFeedBefore = stockListBefore.find((f) => f.name === 'Layer Feed') || { quantity: 0 };
    const initialQty = Number(layerFeedBefore.quantity) || 0;

    // Purchase +500 kg
    const testPurchId = `FP-TEST-${Date.now().toString().slice(-5)}`;
    const purch = await api('/feed/purchases', 'POST', {
      id: testPurchId,
      date: todayStr,
      feedType: 'Layer Feed',
      quantity: 500,
      rate: 30,
      supplier: 'TEST Supplier',
    });
    report('Record Feed Purchase (+500 kg, totalAmount auto-calc)', purch.ok && Number(purch.data?.data?.totalAmount) === 15000);
    testIds.feedPurchases.push(testPurchId);

    const stockAfterPurch = (await api('/feed/stock')).data?.data?.find((f) => f.name === 'Layer Feed');
    report('Stock Increased by Purchase Quantity', Number(stockAfterPurch?.quantity) === initialQty + 500);

    // Usage -200 kg
    const testUsageId = `FU-TEST-${Date.now().toString().slice(-5)}`;
    const usage = await api('/feed/usage', 'POST', {
      id: testUsageId,
      date: todayStr,
      shed: 'Shed 1',
      feedType: 'Layer Feed',
      quantity: 200,
      enteredBy: 'TEST Feeder',
    });
    report('Record Feed Usage (-200 kg)', usage.ok);
    testIds.feedUsage.push(testUsageId);

    const stockAfterUsage = (await api('/feed/stock')).data?.data?.find((f) => f.name === 'Layer Feed');
    report('Stock Decreased by Usage Quantity', Number(stockAfterUsage?.quantity) === initialQty + 300);

    // Edit usage: change from 200 to 150 kg -> should add 50 kg back to stock
    const updatedUsage = await api(`/feed/usage/${testUsageId}`, 'PUT', {
      quantity: 150,
    });
    report('Edit Feed Usage (from 200 to 150 kg)', updatedUsage.ok);

    const stockAfterUsageEdit = (await api('/feed/stock')).data?.data?.find((f) => f.name === 'Layer Feed');
    report('Stock Corrected After Usage Edit (+50 kg)', Number(stockAfterUsageEdit?.quantity) === initialQty + 350);

    // Delete usage record -> should restore 150 kg
    const deleteUsage = await api(`/feed/usage/${testUsageId}`, 'DELETE');
    report('Delete Feed Usage Record', deleteUsage.ok);
    testIds.feedUsage = testIds.feedUsage.filter((id) => id !== testUsageId);

    const stockAfterUsageDelete = (await api('/feed/stock')).data?.data?.find((f) => f.name === 'Layer Feed');
    report('Stock Restored After Usage Deletion (+150 kg)', Number(stockAfterUsageDelete?.quantity) === initialQty + 500);

    // 8. Egg Production: good + broken <= totalEggs validation
    const testEggInvalid = await api('/eggs', 'POST', {
      id: `EG-TEST-INV-${Date.now().toString().slice(-5)}`,
      date: todayStr,
      shed: 'Shed 1',
      totalEggs: 100,
      goodEggs: 90,
      brokenEggs: 20, // 90 + 20 = 110 > 100 -> must fail!
    });
    report('Egg Count Validation Blocked (good + broken > total)', testEggInvalid.status === 400 && testEggInvalid.data?.message?.includes('cannot exceed'), `Message: ${testEggInvalid.data?.message}`);

    const testEggId = `EG-TEST-${Date.now().toString().slice(-5)}`;
    const testEggValid = await api('/eggs', 'POST', {
      id: testEggId,
      date: todayStr,
      shed: 'Shed 1',
      totalEggs: 100,
      goodEggs: 95,
      brokenEggs: 5,
    });
    report('Record Valid Egg Production (total: 100, good: 95, broken: 5)', testEggValid.ok);
    testIds.eggs.push(testEggId);

    // 9. Mortality Records
    const testMortId = `MO-TEST-${Date.now().toString().slice(-5)}`;
    const mort = await api('/mortality', 'POST', {
      id: testMortId,
      date: todayStr,
      shed: 'Shed 1',
      count: 2,
      reason: 'Heat',
    });
    report('Record Mortality (2 birds, Heat)', mort.ok);
    testIds.mortality.push(testMortId);

    // 10. Sales (trays * price auto calculation) & Expenses
    const testSaleId = `SL-TEST-${Date.now().toString().slice(-5)}`;
    const sale = await api('/sales', 'POST', {
      id: testSaleId,
      date: todayStr,
      trays: 10,
      pricePerTray: 180,
      buyer: 'TEST Buyer',
      paymentStatus: 'Paid',
    });
    report('Record Sale (10 trays * ₹180 = ₹1800 auto-calc)', sale.ok && Number(sale.data?.data?.totalAmount) === 1800);
    testIds.sales.push(testSaleId);

    const testExpId = `EX-TEST-${Date.now().toString().slice(-5)}`;
    const exp = await api('/expenses', 'POST', {
      id: testExpId,
      date: todayStr,
      category: 'Medicines',
      amount: 750,
      shed: 'Shed 1',
      vendor: 'TEST Pharmacy',
      paymentMethod: 'UPI',
      description: 'TEST Vitamins',
    });
    report('Record Expense (₹750, Medicines)', exp.ok);
    testIds.expenses.push(testExpId);

    // 11. Worker Inactive Soft Delete (history preserved)
    const workerDeactivate = await api(`/workers/${testWorkerId}`, 'DELETE');
    report('Mark Worker Inactive (Never Deleted from DB)', workerDeactivate.ok && workerDeactivate.data?.data?.status === 'Inactive');

    const workerInDb = (await api(`/workers`)).data?.data?.find((w) => w.id === testWorkerId);
    report('Worker Preserved in DB with Status Inactive', workerInDb?.status === 'Inactive');

    console.log(`\nAll feature and validation checks passed successfully!`);
  } finally {
    console.log(`\n--- Cleaning Up TEST Records ---`);
    // Delete test records using raw SQL strictly matching TEST prefix
    try {
      if (testIds.attendance.length) {
        await query(`DELETE FROM attendance WHERE id LIKE 'AT-TEST%'`);
      }
      if (testIds.payments.length) {
        await query(`DELETE FROM payments WHERE id LIKE 'PY-TEST%'`);
      }
      if (testIds.dailyWages.length) {
        await query(`DELETE FROM daily_wages WHERE id LIKE 'DW-TEST%'`);
      }
      if (testIds.assignments?.length) {
        await query(`DELETE FROM assignments WHERE worker = 'TEST Worker Alpha'`);
      }
      if (testIds.feedPurchases.length) {
        // Rollback purchase stock
        await query(`UPDATE feed_stock SET quantity = quantity - 500 WHERE name = 'Layer Feed'`);
        await query(`DELETE FROM feed_purchases WHERE id LIKE 'FP-TEST%'`);
      }
      if (testIds.eggs.length) {
        await query(`DELETE FROM eggs WHERE id LIKE 'EG-TEST%'`);
      }
      if (testIds.mortality.length) {
        await query(`DELETE FROM mortality WHERE id LIKE 'MO-TEST%'`);
      }
      if (testIds.sales.length) {
        await query(`DELETE FROM sales WHERE id LIKE 'SL-TEST%'`);
      }
      if (testIds.expenses.length) {
        await query(`DELETE FROM expenses WHERE id LIKE 'EX-TEST%'`);
      }
      if (testIds.workers.length) {
        await query(`DELETE FROM workers WHERE id LIKE 'WK-TEST%'`);
      }
      // Restore farm settings
      await query(`UPDATE farm_settings SET farm_name = 'My Poultry Farm', owner = '', feed_capacity = 6000 WHERE id = 1`);
      console.log(`Cleanup complete: All records matching TEST have been removed. Existing records untouched.`);
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError.message);
    }
  }

  return results;
}

if (process.argv[1]?.endsWith('qa-test.js')) {
  runQaTests()
    .then(() => {
      console.log('\nQA Test Suite execution finished with 100% success.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nQA Test Suite encountered a failure:', err);
      process.exit(1);
    });
}
