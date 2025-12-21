import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const source = path.join(root, 'F15_icon.png');
const destinations = [
  path.join(root, 'F16_icon.png'),
  path.join(root, 'public', 'pwa-192x192.png'),
  path.join(root, 'public', 'pwa-512x512.png'),
  path.join(root, 'public', 'apple-touch-icon.png')
];

console.log(`Preparing to replace icons with ${source}...`);

if (!fs.existsSync(source)) {
  console.error(`Error: Source file not found at ${source}`);
  process.exit(1);
}

let successCount = 0;

destinations.forEach(dest => {
  try {
    fs.copyFileSync(source, dest);
    console.log(`✅ Replaced: ${path.relative(root, dest)}`);
    successCount++;
  } catch (e) {
    console.error(`❌ Failed to replace ${path.relative(root, dest)}:`, e.message);
  }
});

if (successCount === destinations.length) {
  console.log('\n🎉 All icons updated successfully!');
  console.log('Please delete the PWA from your home screen and re-add it to see the changes.');
} else {
  console.log(`\n⚠️  Completed with errors (${successCount}/${destinations.length} updated).`);
}
