const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // จำเป็นสำหรับ Neon
});

// helper แทน better-sqlite3 API เดิม
const db = {
  async query(sql, params = []) {
    const res = await pool.query(sql, params);
    return res;
  },
  async get(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows[0] || null;
  },
  async all(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows;
  },
  async run(sql, params = []) {
    const res = await pool.query(sql, params);
    return res;
  },
};

// สร้างตารางถ้ายังไม่มี (รันทุกครั้งที่ server เริ่ม ปลอดภัยเพราะใช้ IF NOT EXISTS)
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      line_user_id TEXT UNIQUE NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS beds (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      current_request_id INTEGER,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      patient_hn TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      ward TEXT NOT NULL,
      diagnosis TEXT,
      urgency TEXT NOT NULL DEFAULT 'urgent',
      status TEXT NOT NULL DEFAULT 'pending',
      requester_line_id TEXT NOT NULL,
      requester_name TEXT,
      contact_phone TEXT,
      assigned_bed_id INTEGER,
      approver_line_id TEXT,
      decision_note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id SERIAL PRIMARY KEY,
      request_id INTEGER,
      to_line_id TEXT,
      message TEXT,
      sent_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS form_submissions (
      id SERIAL PRIMARY KEY,
      form_type TEXT NOT NULL,
      patient_name TEXT,
      patient_hn TEXT,
      ward TEXT,
      diagnosis TEXT,
      icu_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      urgency TEXT DEFAULT 'normal',
      admission_status TEXT DEFAULT 'pending',
      assigned_bed TEXT,
      decision_note TEXT,
      approver_line_id TEXT,
      extra_data JSONB,
      submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      ward TEXT NOT NULL,
      subscription JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log('DB: ตารางพร้อมใช้งาน');
}

module.exports = { db, initDB };
