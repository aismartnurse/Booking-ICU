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
  `);

  // Migration: เพิ่ม column ใหม่สำหรับ DB เก่า (ถ้ามีอยู่แล้วจะ ignore)
  const migrations = [
    "ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'normal'",
    "ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS admission_status TEXT DEFAULT 'pending'",
    "ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS assigned_bed TEXT",
    "ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS decision_note TEXT",
    "ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS approver_line_id TEXT",
    "ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",
    // เปลี่ยนชื่อเตียงจาก ICU-0X เป็น 1-7
    "UPDATE beds SET label='1' WHERE label='ICU-01'",
    "UPDATE beds SET label='2' WHERE label='ICU-02'",
    "UPDATE beds SET label='3' WHERE label='ICU-03'",
    "UPDATE beds SET label='4' WHERE label='ICU-04'",
    "UPDATE beds SET label='5' WHERE label='ICU-05'",
    "UPDATE beds SET label='6' WHERE label='ICU-06'",
    "UPDATE beds SET label='7' WHERE label='ICU-07'",
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch (e) { /* ignore */ }
  }

  console.log('DB: ตารางพร้อมใช้งาน');
}

module.exports = { db, initDB };
