const express = require('express');
const line = require('@line/bot-sdk');
const { db } = require('../db');
const { client, config, pushText } = require('../lib/line');

const router = express.Router();

router.post('/', line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

async function handleEvent(event) {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  const existing = await db.get('SELECT * FROM users WHERE line_user_id = $1', [lineUserId]);
  if (!existing) {
    let displayName = null;
    try {
      const profile = await client.getProfile(lineUserId);
      displayName = profile.displayName;
    } catch (e) {}
    await db.run(
      "INSERT INTO users (line_user_id, display_name, role) VALUES ($1, $2, 'pending') ON CONFLICT (line_user_id) DO NOTHING",
      [lineUserId, displayName]
    );
  }

  if (event.type === 'follow') {
    await pushText(lineUserId,
      'ยินดีต้อนรับสู่ระบบจองเตียง ICU\n' +
      'บัญชีของท่านอยู่ระหว่างรอแอดมินอนุมัติสิทธิ์ กรุณาติดต่อแผนก ICU เพื่อยืนยันตัวตน\n' +
      'เมื่อได้รับสิทธิ์แล้วสามารถใช้เมนูด้านล่างได้ทันที'
    );
  } else if (event.type === 'message' && event.message.type === 'text') {
    await pushText(lineUserId, 'กรุณาใช้เมนูด้านล่าง (Rich Menu) เพื่อขอจองเตียง ICU หรือพิจารณาคำขอ');
  }
}

module.exports = router;
