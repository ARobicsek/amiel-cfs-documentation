import webpush from 'web-push';
import dotenv from 'dotenv';
dotenv.config(); // Load from .env if available, though Vercel environment should have them

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_EMAIL || 'mailto:test@example.com';

console.log('--- VAPID Key Validation ---');

if (!publicKey || !privateKey) {
  console.error('❌ Missing VAPID keys in environment');
  process.exit(1);
}

console.log(`Public Key Length: ${publicKey.length}`);
console.log(`Private Key Length: ${privateKey.length}`);

try {
  webpush.setVapidDetails(
    subject,
    publicKey,
    privateKey
  );
  console.log('✅ web-push accepted the keys (format is valid)');
} catch (error) {
  console.error('❌ web-push rejected the keys:', error.message);
  process.exit(1);
}

// Attempt a mock generation of headers to verify crypto pair
try {
  const headers = webpush.getVapidHeaders(
    'https://fcm.googleapis.com/fcm/send/test',
    subject,
    publicKey,
    privateKey,
    'aes128gcm'
  );
  console.log('✅ Successfully generated VAPID headers (Crypto pair is valid)');
  console.log('Header preview:', JSON.stringify(headers).substring(0, 100) + '...');
} catch (error) {
  console.error('❌ Failed to generate VAPID headers (Crypto pair invalid?):', error.message);
}
