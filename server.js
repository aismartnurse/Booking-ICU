require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const { initDB } = require('./db');

const webhookRouter = require('./routes/webhook');
const apiRouter = require('./routes/api');

const app = express();

app.use('/webhook', webhookRouter);
app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  maxAge: 12 * 60 * 60 * 1000,
}));

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;

// เริ่ม server หลังจาก initDB สำเร็จ
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`ICU Bed Booking server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('ไม่สามารถเชื่อมต่อฐานข้อมูลได้:', err.message);
    process.exit(1);
  });
