
// The problematic timestamp format from Health Auto Export
const TEST_CASES = [
    "2026-01-28 18:03:53 -0500",
    "2026-01-29 09:27:08 -0500",
    "2026-01-29 00:00:00 -0500"
];

function manualParse(str) {
    if (!str) return null;

    // 1. Try manual regex parsing for the known Health Auto Export format: "YYYY-MM-DD HH:mm:ss -ZZZZ"
    // Example: "2026-01-28 18:03:53 -0500"
    const regex = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/;
    const match = str.match(regex);

    if (match) {
        // Construct ISO 8601 string: "YYYY-MM-DDTHH:mm:ss+/-HH:mm"
        // This is universally supported by new Date() in modern browsers.
        const isoString = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7]}${match[8]}:${match[9]}`;
        const d = new Date(isoString);
        if (!isNaN(d.getTime())) return d;
    }

    // 2. Fallback to standard Date parsing (e.g. for "1/29/2026, 4:59:12 AM" or ISO strings)
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;

    // 3. Last resort fallback: try replacing space with T if it looks like partial ISO
    try {
        let iso = str.trim();
        if (/^\d{4}-\d{2}-\d{2}\s\d{2}:/.test(iso)) {
            iso = iso.replace(' ', 'T');
        }
        const d2 = new Date(iso);
        return isNaN(d2.getTime()) ? null : d2;
    } catch {
        return null;
    }
}

console.log("Testing Date Parsing...");

TEST_CASES.forEach(ts => {
    console.log(`\nInput: "${ts}"`);

    // Test 1: Standard new Date() - fails on Safari, might work in Node
    const d1 = new Date(ts);
    console.log(`new Date(): ${d1.toString()} (Valid: ${!isNaN(d1.getTime())})`);

    // Test 2: Proposed Manual Parse
    const d2 = manualParse(ts);
    console.log(`Manual Parse: ${d2.toString()} (Valid: ${!isNaN(d2.getTime())})`);

    if (isNaN(d2.getTime())) {
        console.error("MANUAL PARSE FAILED");
        process.exit(1);
    } else {
        console.log("Manual Parse SUCCESS");
    }
});
