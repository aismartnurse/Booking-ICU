const line = require('@line/bot-sdk');
const { db } = require('../db');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

async function pushText(toLineId, text, requestId = null) {
  try {
    await client.pushMessage(toLineId, { type: 'text', text });
    await db.run(
      'INSERT INTO notification_log (request_id, to_line_id, message) VALUES ($1, $2, $3)',
      [requestId, toLineId, text]
    );
  } catch (err) {
    console.error('LINE push error:', err.originalError?.response?.data || err.message);
  }
}

async function notifyAllApprovers(text, requestId = null) {
  const approvers = await db.all("SELECT line_user_id FROM users WHERE role = 'approver'");
  for (const a of approvers) await pushText(a.line_user_id, text, requestId);
}

function urgencyLabel(u) {
  return { emergency: '🔴 ฉุกเฉินมาก', urgent: '🟠 ด่วน', elective: '🟢 ไม่เร่งด่วน' }[u] || u;
}

async function notifyNewRequest(req) {
  const baseUrl = process.env.PUBLIC_BASE_URL || '';
  const liffApprove = process.env.LIFF_ID_APPROVE
    ? `https://liff.line.me/${process.env.LIFF_ID_APPROVE}?requestId=${req.id}`
    : `${baseUrl}/liff-approve.html?requestId=${req.id}`;

  const text =
    `🛏️ คำขอจองเตียง ICU ใหม่ #${req.id}\n` +
    `ผู้ป่วย: ${req.patient_name} (HN: ${req.patient_hn})\n` +
    `หอผู้ป่วยต้นทาง: ${req.ward}\n` +
    `ความเร่งด่วน: ${urgencyLabel(req.urgency)}\n` +
    `ผู้ขอ: ${req.requester_name || '-'}\n\n` +
    `กดลิงก์เพื่อพิจารณาและตอบกลับ:\n${liffApprove}`;

  await notifyAllApprovers(text, req.id);
}

async function notifyDecision(req, bedLabel) {
  let text;
  if (req.status === 'approved') {
    text =
      `✅ คำขอจองเตียง ICU #${req.id} ได้รับการอนุมัติ\n` +
      `ผู้ป่วย: ${req.patient_name} (HN: ${req.patient_hn})\n` +
      `เตียงที่จัดให้: ${bedLabel}\n` +
      (req.decision_note ? `หมายเหตุ: ${req.decision_note}` : '');
  } else if (req.status === 'waiting') {
    text =
      `⏳ คำขอจองเตียง ICU #${req.id} ถูกเพิ่มใน waiting list\n` +
      `ผู้ป่วย: ${req.patient_name} (HN: ${req.patient_hn})\n` +
      (req.decision_note ? `หมายเหตุ: ${req.decision_note}` : '');
  } else {
    text =
      `❌ คำขอจองเตียง ICU #${req.id} ถูกปฏิเสธ\n` +
      `ผู้ป่วย: ${req.patient_name} (HN: ${req.patient_hn})\n` +
      `เหตุผล: ${req.decision_note || '-'}`;
  }
  await pushText(req.requester_line_id, text, req.id);
}

module.exports = { client, config, pushText, notifyAllApprovers, notifyNewRequest, notifyDecision };
