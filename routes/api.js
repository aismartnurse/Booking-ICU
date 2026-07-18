const express = require('express');
const { db } = require('../db');
const { notifyNewRequest, notifyDecision } = require('../lib/line');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ---------- Auth ----------
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'invalid credentials' });
});

router.post('/admin/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
router.get('/admin/check', (req, res) => { res.json({ isAdmin: !!(req.session && req.session.isAdmin) }); });

// ---------- Users ----------
router.post('/users/register', async (req, res) => {
  const { lineUserId, displayName } = req.body;
  if (!lineUserId) return res.status(400).json({ error: 'lineUserId required' });
  try {
    await db.run(
      `INSERT INTO users (line_user_id, display_name, role) VALUES ($1, $2, 'pending')
       ON CONFLICT (line_user_id) DO UPDATE SET display_name = COALESCE($2, users.display_name)`,
      [lineUserId, displayName || null]
    );
    const user = await db.get('SELECT * FROM users WHERE line_user_id = $1', [lineUserId]);
    res.json({ role: user.role, displayName: user.display_name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  res.json(await db.all('SELECT * FROM users ORDER BY created_at DESC'));
});

router.put('/admin/users/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['pending', 'requester', 'approver'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  await db.run('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  res.json({ ok: true });
});

router.put('/admin/users/:id/name', requireAdmin, async (req, res) => {
  const { displayName } = req.body;
  if (!displayName) return res.status(400).json({ error: 'displayName required' });
  await db.run('UPDATE users SET display_name = $1 WHERE id = $2', [displayName, req.params.id]);
  res.json({ ok: true });
});

// ---------- Beds ----------
router.get('/beds', async (req, res) => {
  res.json(await db.all('SELECT * FROM beds ORDER BY id'));
});

router.put('/admin/beds/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!['available', 'occupied', 'cleaning', 'closed'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  await db.run(
    `UPDATE beds SET status = $1, updated_at = NOW(),
     current_request_id = CASE WHEN $1 = 'available' THEN NULL ELSE current_request_id END
     WHERE id = $2`,
    [status, req.params.id]
  );
  res.json({ ok: true });
});

router.post('/admin/beds', requireAdmin, async (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  const r = await db.get("INSERT INTO beds (label, status) VALUES ($1, 'available') RETURNING id", [label]);
  res.json({ id: r.id });
});

// ---------- Requests ----------
router.post('/requests', async (req, res) => {
  const { patientHn, patientName, ward, diagnosis, urgency, requesterLineId, requesterName, contactPhone } = req.body;
  if (!patientHn || !patientName || !ward || !requesterLineId) return res.status(400).json({ error: 'missing required fields' });
  try {
    const newReq = await db.get(
      `INSERT INTO requests (patient_hn, patient_name, ward, diagnosis, urgency, requester_line_id, requester_name, contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [patientHn, patientName, ward, diagnosis || null, urgency || 'urgent', requesterLineId, requesterName || null, contactPhone || null]
    );
    notifyNewRequest(newReq).catch(console.error);
    res.json(newReq);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/requests/:id', async (req, res) => {
  const r = await db.get('SELECT * FROM requests WHERE id = $1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(r);
});

router.get('/requests', async (req, res) => {
  const { status } = req.query;
  const rows = status
    ? await db.all('SELECT * FROM requests WHERE status = $1 ORDER BY created_at DESC', [status])
    : await db.all('SELECT * FROM requests ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/requests/:id/decision', async (req, res) => {
  const { decision, bedId, note, approverLineId } = req.body;
  const reqRow = await db.get('SELECT * FROM requests WHERE id = $1', [req.params.id]);
  if (!reqRow) return res.status(404).json({ error: 'not found' });
  if (reqRow.status !== 'pending') return res.status(409).json({ error: 'request already processed' });
  if (!['approved', 'rejected', 'waiting'].includes(decision)) return res.status(400).json({ error: 'invalid decision' });

  let bedLabel = null;
  if (decision === 'approved') {
    if (!bedId) return res.status(400).json({ error: 'bedId required when approving' });
    const bed = await db.get('SELECT * FROM beds WHERE id = $1', [bedId]);
    if (!bed || bed.status !== 'available') return res.status(409).json({ error: 'bed not available' });
    await db.run("UPDATE beds SET status = 'occupied', current_request_id = $1, updated_at = NOW() WHERE id = $2", [reqRow.id, bedId]);
    bedLabel = bed.label;
  }

  const updated = await db.get(
    `UPDATE requests SET status=$1, assigned_bed_id=$2, approver_line_id=$3, decision_note=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [decision, decision === 'approved' ? bedId : null, approverLineId || null, note || null, reqRow.id]
  );
  notifyDecision(updated, bedLabel).catch(console.error);
  res.json(updated);
});

router.post('/beds/:id/discharge', async (req, res) => {
  const bed = await db.get('SELECT * FROM beds WHERE id = $1', [req.params.id]);
  if (!bed) return res.status(404).json({ error: 'not found' });
  await db.run("UPDATE beds SET status = 'cleaning', current_request_id = NULL, updated_at = NOW() WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// ---------- Auto-seed beds ----------
router.post('/admin/seed-beds', requireAdmin, async (req, res) => {
  const count = parseInt(process.env.INITIAL_BED_COUNT || '10', 10);
  const existing = await db.get('SELECT COUNT(*) as c FROM beds');
  if (parseInt(existing.c) > 0) return res.json({ message: 'มีเตียงอยู่แล้ว ข้ามการ seed' });
  for (let i = 1; i <= count; i++) {
    await db.run("INSERT INTO beds (label, status) VALUES ($1, 'available')", [`ICU-${String(i).padStart(2, '0')}`]);
  }
  res.json({ message: `สร้างเตียง ${count} เตียงเรียบร้อย` });
});

// ---------- Google Form Submissions ----------
// รับข้อมูลจาก Google Apps Script (ไม่ต้อง auth เพราะมี secret key)
router.post('/form-submission', async (req, res) => {
  const { secret, formType, patientName, patientHn, ward, diagnosis, icuType, extraData } = req.body;
  if (secret !== process.env.FORM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const row = await db.get(
      `INSERT INTO form_submissions (form_type, patient_name, patient_hn, ward, diagnosis, icu_type, urgency, extra_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [formType, patientName || null, patientHn || null, ward || null, diagnosis || null, icuType || null,
       formType === 'crisis' ? 'emergency' : 'normal',
       JSON.stringify(extraData || {})]
    );

    // ไม่ส่ง LINE หา approver แล้ว — ทีม ICU เห็นคำขอใหม่บน Dashboard (มีเสียงเตือน + รีเฟรชอัตโนมัติ)
    // ช่วยประหยัดโควตาข้อความ LINE

    res.json({ ok: true, id: row.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Public endpoint สำหรับหน้า status.html (ไม่ต้อง login)
router.get('/public/form-submissions', async (req, res) => {
  const rows = await db.all("SELECT * FROM form_submissions ORDER BY submitted_at DESC");
  res.json(rows);
});

router.get('/form-submissions', requireAdmin, async (req, res) => {
  const { status } = req.query;
  const rows = status
    ? await db.all('SELECT * FROM form_submissions WHERE status = $1 ORDER BY submitted_at DESC', [status])
    : await db.all('SELECT * FROM form_submissions ORDER BY submitted_at DESC');
  res.json(rows);
});

router.get('/form-submissions/:id', requireAdmin, async (req, res) => {
  const row = await db.get('SELECT * FROM form_submissions WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

router.post('/form-submissions/:id/decision', requireAdmin, async (req, res) => {
  const { decision, assignedBed, note } = req.body;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'invalid decision' });
  const row = await db.get('SELECT * FROM form_submissions WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not found' });
  await db.run(
    'UPDATE form_submissions SET status=$1, assigned_bed=$2, decision_note=$3, updated_at=NOW() WHERE id=$4',
    [decision, assignedBed || null, note || null, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/form-submissions/:id', requireAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM form_submissions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/form-submissions/:id/icu-type', requireAdmin, async (req, res) => {
  const { icuType } = req.body;
  if (!['plan','unplan'].includes(icuType)) return res.status(400).json({ error: 'invalid' });
  await db.run('UPDATE form_submissions SET icu_type=$1, updated_at=NOW() WHERE id=$2', [icuType, req.params.id]);
  res.json({ ok: true });
});

router.put('/form-submissions/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!['pending','acknowledged','waiting_bed','failed','completed'].includes(status)) return res.status(400).json({ error: 'invalid' });

  const row = await db.get('SELECT * FROM form_submissions WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not found' });

  await db.run('UPDATE form_submissions SET status=$1, updated_at=NOW() WHERE id=$2', [status, req.params.id]);

  const statusLabel = {
    pending: '⏳ รอดำเนินการ',
    acknowledged: '✅ รับทราบ รอดำเนินการ',
    waiting_bed: '🟡 รับทราบ รอเตียงว่าง',
    failed: '❌ คำขอยังไม่สำเร็จ',
    completed: '🎉 ดำเนินการเสร็จสิ้น',
  };

  const msg =
    `🔔 อัปเดตสถานะคำขอ ICU\n` +
    `ผู้ป่วย: ${row.patient_name} (HN: ${row.patient_hn})\n` +
    `หอผู้ป่วย: ${row.ward}\n` +
    `ประเภท: ${row.form_type === 'or' ? 'ICU for OR' : 'ICU Crisis'}\n` +
    `สถานะใหม่: ${statusLabel[status] || status}`;

  const { pushText } = require('../lib/line');

  // ไม่ส่งหา approver แล้ว (ทีม ICU ดูจาก Dashboard) — แจ้งเฉพาะ ward ที่เกี่ยวข้อง
  // แจ้งกลับ ward — หา LINE user ที่ชื่อตรงกับ ward ใน form
  try {
    const wardName = (row.ward || '').toLowerCase().replace(/\s/g, '');
    const users = await db.all("SELECT line_user_id, display_name FROM users WHERE role = 'requester'");
    for (const u of users) {
      const name = (u.display_name || '').toLowerCase().replace(/\s/g, '');
      if (name && wardName && wardName.includes(name.replace('ward','')||'') || name.includes(wardName)) {
        pushText(u.line_user_id, msg).catch(console.error);
      }
    }
  } catch(e) { console.error('ward notify error:', e.message); }

  res.json({ ok: true });
});

router.put('/form-submissions/:id/note', requireAdmin, async (req, res) => {
  const { note } = req.body;
  await db.run('UPDATE form_submissions SET decision_note=$1, updated_at=NOW() WHERE id=$2', [note||null, req.params.id]);
  res.json({ ok: true });
});

// แก้ไขชื่อผู้ป่วย / HN
router.put('/form-submissions/:id/patient', requireAdmin, async (req, res) => {
  const { patientName, patientHn } = req.body;
  await db.run(
    'UPDATE form_submissions SET patient_name=$1, patient_hn=$2, updated_at=NOW() WHERE id=$3',
    [(patientName||'').trim() || null, (patientHn||'').trim() || null, req.params.id]
  );
  res.json({ ok: true });
});

router.put('/form-submissions/:id/urgency', requireAdmin, async (req, res) => {
  const { urgency } = req.body;
  if (!['emergency', 'urgent', 'normal'].includes(urgency)) return res.status(400).json({ error: 'invalid urgency' });
  await db.run('UPDATE form_submissions SET urgency=$1, updated_at=NOW() WHERE id=$2', [urgency, req.params.id]);
  res.json({ ok: true });
});

router.put('/form-submissions/:id/admission', requireAdmin, async (req, res) => {
  const { admissionStatus, assignedBed, destinationWard } = req.body;
  if (!['pending', 'confirmed', 'return_ward', 'discharged'].includes(admissionStatus)) return res.status(400).json({ error: 'invalid status' });

  const row = await db.get('SELECT * FROM form_submissions WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not found' });

  await db.run(
    'UPDATE form_submissions SET admission_status=$1, assigned_bed=$2, updated_at=NOW() WHERE id=$3',
    [admissionStatus, assignedBed || null, req.params.id]
  );

  // ward ปลายทาง: ถ้าเลือกไว้ใช้อันนั้น ไม่งั้นใช้ ward ต้นทาง
  const destWard = (admissionStatus === 'discharged' && destinationWard) ? destinationWard : row.ward;

  // เก็บ ward ปลายทางลง extra_data (สำหรับกรณีย้ายกลับ)
  if (admissionStatus === 'discharged') {
    try {
      let extra = row.extra_data;
      if (typeof extra === 'string') extra = JSON.parse(extra || '{}');
      extra = extra || {};
      extra.destination_ward = destWard;
      await db.run('UPDATE form_submissions SET extra_data=$1 WHERE id=$2', [JSON.stringify(extra), req.params.id]);
    } catch (e) { console.error('extra_data update error:', e.message); }
  }

  // แจ้งเตือน LINE
  const { pushText } = require('../lib/line');
  let msg = '';
  if (admissionStatus === 'confirmed' && assignedBed) {
    msg =
      `✅ ผู้ป่วยเข้า ICU แล้ว\n` +
      `ผู้ป่วย: ${row.patient_name} (HN: ${row.patient_hn})\n` +
      `หอผู้ป่วย: ${row.ward}\n` +
      `🛏️ เตียงที่ได้: ${assignedBed}`;
  } else if (admissionStatus === 'return_ward') {
    msg =
      `🔙 ผู้ป่วยไม่เข้า ICU - กลับ Ward\n` +
      `ผู้ป่วย: ${row.patient_name} (HN: ${row.patient_hn})\n` +
      `หอผู้ป่วย: ${row.ward}`;
  } else if (admissionStatus === 'discharged') {
    msg =
      `🏠 ผู้ป่วยอาการดีขึ้น ย้ายกลับ Ward\n` +
      `ผู้ป่วย: ${row.patient_name} (HN: ${row.patient_hn})\n` +
      `หอผู้ป่วยต้นทาง: ${row.ward}\n` +
      `หอผู้ป่วยปลายทาง: ${destWard}` +
      (row.assigned_bed ? `\nออกจากเตียง ICU: ${row.assigned_bed}` : '');
  }
  if (msg) {
    // ไม่ส่งหา approver แล้ว (ทีม ICU ดูจาก Dashboard) — แจ้งเฉพาะ ward ที่เกี่ยวข้อง
    // แจ้งกลับ ward — ต้นทางและปลายทาง (ถ้าต่างกัน)
    try {
      const targetWards = [...new Set([row.ward, destWard].filter(Boolean))]
        .map(w => w.toLowerCase().replace(/\s/g, ''));
      const users = await db.all("SELECT line_user_id, display_name FROM users WHERE role = 'requester'");
      const sent = new Set();
      for (const u of users) {
        const name = (u.display_name || '').toLowerCase().replace(/\s/g, '');
        if (!name || sent.has(u.line_user_id)) continue;
        const match = targetWards.some(wardName =>
          (wardName && (wardName.includes(name.replace('ward', '') || '') || name.includes(wardName)))
        );
        if (match) {
          pushText(u.line_user_id, msg).catch(console.error);
          sent.add(u.line_user_id);
        }
      }
    } catch(e) { console.error('ward notify error:', e.message); }
  }

  res.json({ ok: true });
});

```javascript
// ===== Web Push =====
router.get('/push/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

router.post('/push/subscribe', async (req, res) => {
  const { ward, subscription } = req.body;
  if (!ward || !subscription) return res.status(400).json({ error: 'missing' });
  await db.run(
    'INSERT INTO push_subscriptions (ward, subscription) VALUES ($1, $2)',
    [ward, JSON.stringify(subscription)]
  );
  res.json({ ok: true });
});

router.post('/push/unsubscribe', async (req, res) => {
  const { subscription } = req.body;
  await db.run(
    'DELETE FROM push_subscriptions WHERE subscription = $1',
    [JSON.stringify(subscription)]
  );
  res.json({ ok: true });
});

module.exports = router;
