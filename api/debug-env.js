export default async function handler(req, res) {
  // Simple debug endpoint to check environment variables
  res.json({
    secretTokenSet: !!process.env.SECRET_TOKEN,
    secretTokenLength: process.env.SECRET_TOKEN?.length || 0,
    envKeys: Object.keys(process.env).filter(k => k.includes('SECRET') || k.includes('TOKEN'))
  });
}