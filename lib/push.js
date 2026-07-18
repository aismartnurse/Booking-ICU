const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:' + (process.env.ADMIN_EMAIL || 'admin@hospital.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function notifyWard(db, ward, title, body) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const subs = await db.all(
      'SELECT subscription FROM push_subscriptions WHERE ward = $1',
      [ward]
    );
    const payload = JSON.stringify({ title, body });
    for (const row of subs) {
      const sub = typeof row.subscription === 'string'
        ? JSON.parse(row.subscription) : row.subscription;
      try {
        await webpush.sendNotification(sub, payload);
      } catch(e) {
        // subscription หมดอายุ ลบออก
        if (e.statusCode === 410) {
          await db.run(
            'DELETE FROM push_subscriptions WHERE subscription = $1',
            [JSON.stringify(sub)]
          );
        }
      }
    }
  } catch(e) {
    console.error('Push notify error:', e.message);
  }
}

module.exports = { webpush, notifyWard };
