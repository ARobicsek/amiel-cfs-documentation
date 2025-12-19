export default async function handler(req, res) {
  let serviceAccountValid = false;
  let serviceAccountError = null;
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        serviceAccountValid = true;
    }
  } catch (e) {
    serviceAccountError = e.message;
  }

  // Simple debug endpoint to check environment variables
  res.json({
    secretTokenSet: !!process.env.SECRET_TOKEN,
    secretTokenLength: process.env.SECRET_TOKEN?.length || 0,
    googleSheetIdSet: !!process.env.GOOGLE_SHEET_ID,
    serviceAccountKeySet: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    serviceAccountKeyValidJson: serviceAccountValid,
    serviceAccountKeyParseError: serviceAccountError,
    envKeys: Object.keys(process.env).filter(k => k.includes('SECRET') || k.includes('TOKEN') || k.includes('GOOGLE') || k.includes('VAPID'))
  });
}