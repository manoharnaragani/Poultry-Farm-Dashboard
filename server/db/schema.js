import { query, withTx } from './pool.js';

// Tables are created automatically on startup (safe to run many times).
const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS farm_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  farm_name TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'INR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  feed_capacity NUMERIC(12,2) NOT NULL DEFAULT 6000 CHECK (feed_capacity >= 0)
);

CREATE TABLE IF NOT EXISTS sheds (
  id INTEGER PRIMARY KEY,
  seq BIGSERIAL,
  name TEXT NOT NULL,
  hens INTEGER NOT NULL DEFAULT 0 CHECK (hens >= 0),
  notes TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  joining_date DATE,
  assigned_shed TEXT NOT NULL DEFAULT 'Shed 1',
  role TEXT NOT NULL DEFAULT '',
  salary_type TEXT NOT NULL DEFAULT 'Monthly',
  salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  emergency_contact TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  worker TEXT NOT NULL DEFAULT '',
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Present',
  check_in TEXT NOT NULL DEFAULT '',
  check_out TEXT NOT NULL DEFAULT '',
  working_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  overtime NUMERIC(6,2) NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_worker_date_key UNIQUE (worker_id, date)
);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance (date);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  worker_id TEXT REFERENCES workers(id),
  worker TEXT NOT NULL DEFAULT '',
  date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'Salary',
  method TEXT NOT NULL DEFAULT 'Cash',
  payment_status TEXT NOT NULL DEFAULT 'Paid',
  reason TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_date_idx ON payments (date);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  worker TEXT NOT NULL DEFAULT '',
  shed TEXT NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  end_date DATE,
  reason TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_wages (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  worker_id TEXT REFERENCES workers(id),
  worker TEXT NOT NULL DEFAULT '',
  date DATE NOT NULL,
  shed TEXT NOT NULL DEFAULT '',
  work TEXT NOT NULL DEFAULT '',
  wage NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'Pending',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_stock (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_stock NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  updated DATE,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_usage (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  date DATE NOT NULL,
  shed TEXT NOT NULL DEFAULT '',
  feed_type TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  entered_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feed_usage_date_idx ON feed_usage (date);

CREATE TABLE IF NOT EXISTS feed_purchases (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  date DATE NOT NULL,
  feed_type TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  rate NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feed_purchases_date_idx ON feed_purchases (date);

CREATE TABLE IF NOT EXISTS eggs (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  date DATE NOT NULL,
  shed TEXT NOT NULL DEFAULT '',
  total_eggs INTEGER NOT NULL DEFAULT 0 CHECK (total_eggs >= 0),
  good_eggs INTEGER NOT NULL DEFAULT 0 CHECK (good_eggs >= 0),
  broken_eggs INTEGER NOT NULL DEFAULT 0 CHECK (broken_eggs >= 0),
  notes TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eggs_counts_check CHECK (good_eggs + broken_eggs <= total_eggs)
);
CREATE INDEX IF NOT EXISTS eggs_date_idx ON eggs (date);

CREATE TABLE IF NOT EXISTS mortality (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  date DATE NOT NULL,
  shed TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mortality_date_idx ON mortality (date);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  date DATE NOT NULL,
  trays NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (trays >= 0),
  price_per_tray NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_per_tray >= 0),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  buyer TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'Paid',
  notes TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_date_idx ON sales (date);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL,
  date DATE NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  shed TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'Cash',
  description TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (date);
`;

export async function initSchema() {
  await query(DDL);
  await query('ALTER TABLE farm_settings ADD COLUMN IF NOT EXISTS feed_capacity NUMERIC(12,2) NOT NULL DEFAULT 6000');
  await withTx(async (client) => {
    // One-time starter data: an empty farm with 3 sheds and 3 feed types (edit them in the app).
    const seeded = await client.query("SELECT 1 FROM meta WHERE key = 'seeded' FOR UPDATE");
    if (seeded.rowCount) return;
    await client.query("INSERT INTO farm_settings (id, farm_name, owner) VALUES (1, 'My Poultry Farm', '') ON CONFLICT (id) DO NOTHING");
    for (const i of [1, 2, 3]) await client.query('INSERT INTO sheds (id, name, hens) VALUES ($1, $2, 0) ON CONFLICT (id) DO NOTHING', [i, `Shed ${i}`]);
    const feeds = ['Layer Feed', 'Layer Premium', 'Grower Feed'];
    for (const [i, name] of feeds.entries()) {
      await client.query('INSERT INTO feed_stock (id, name, type, quantity, min_stock, updated) VALUES ($1, $2, $2, 0, 0, CURRENT_DATE) ON CONFLICT (id) DO NOTHING', [`FD-0${i + 1}`, name]);
    }
    await client.query("INSERT INTO meta (key, value) VALUES ('seeded', 'true') ON CONFLICT (key) DO NOTHING");
  });
}
