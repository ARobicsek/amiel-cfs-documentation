# LLM-Generated Dark Jokes Implementation Plan

## Overview

Enhance the notification system with OpenAI-generated dark jokes while maintaining 100% reliability through a multi-layer fallback strategy.

## Current Implementation

**How jokes work today:**
- File: `api/send-notification.js` (lines 33-41)
- Uses public API: `https://official-joke-api.appspot.com/random_joke`
- Fetched just-in-time when notification fires
- No fallback - if API fails, notification could fail

## Chosen Approach: Smart Pre-Fetch with Adaptive Refill

### Architecture Summary

**Pre-fetch batch generation** with **adaptive cache refill** when running low:
- Daily check at 6 PM ET (before 9 PM notification)
- Only generates jokes if cache is low (< 3 jokes per subject)
- Cache stored in Google Sheets `JokeCache` tab
- 3-layer fallback: Cache → OpenAI API → Static fallbacks

### User Requirements

1. **LLM Integration**: OpenAI API for dark joke generation
2. **Subject Selection**: User provides custom list of joke topics
3. **Random Rotation**: Automatically rotate through selected subjects
4. **Critical Reliability**: Must work even if API is down/offline/rate-limited
5. **User has OpenAI API key**: Will provide during implementation

## Implementation Plan

### Phase 1: Backend Infrastructure

#### 1.1 Create OpenAI Client Helper
**File**: `api/helpers/openai-client.js` (NEW)

```javascript
// Reusable OpenAI API wrapper
export async function generateJokes(apiKey, subject, count = 5) {
  // Call OpenAI API with user's key
  // Prompt: Generate {count} dark jokes about {subject}
  // Model: gpt-4o-mini (cost-effective)
  // Return array of joke strings
}
```

**Error Handling**:
- Retry with exponential backoff (up to 3 attempts)
- Timeout after 8 seconds per request
- Throw descriptive errors for debugging

#### 1.2 Create Static Fallback Jokes
**File**: `api/fallback-jokes.js` (NEW)

```javascript
// Hardcoded fallback jokes organized by subject
export const FALLBACK_JOKES = {
  'death': [...],
  'illness': [...],
  'existential': [...],
  'technology': [...]
};

export function getFallbackJoke(subject) {
  // Return random joke for subject
  // If subject not found, return from any category
}
```

- 5-10 jokes per default subject
- User can add custom subjects, but they'll fall back to generic pool

#### 1.3 Create Joke Cache Manager
**File**: `api/helpers/joke-cache.js` (NEW)

```javascript
// Manages Google Sheets JokeCache tab operations
export async function getCachedJokes(sheets, spreadsheetId, subject) {
  // Query JokeCache for unused jokes matching subject
  // Return array of joke objects: { rowIndex, subject, joke, timestamp }
}

export async function markJokeAsUsed(sheets, spreadsheetId, rowIndex) {
  // Update Used=TRUE, UsedAt=timestamp for given row
}

export async function addJokesToCache(sheets, spreadsheetId, subject, jokes) {
  // Append new jokes to JokeCache tab
  // Columns: Subject, Joke, GeneratedAt, Used, UsedAt
}

export async function getCacheHealth(sheets, spreadsheetId, subjects) {
  // Return count of unused jokes per subject
  // { 'death': 5, 'illness': 2, ... }
}
```

#### 1.4 Create Joke Generation Cron
**File**: `api/generate-jokes.js` (NEW)

**Cron Schedule**: Daily at 6 PM ET (3 hours before notifications)

```javascript
export default async function handler(req, res) {
  // 1. Authenticate with Google Sheets
  // 2. Fetch user settings (subjects, API key) from UserSettings!F2:G2
  // 3. Check cache health for each subject
  // 4. For subjects with < 3 unused jokes:
  //    a. Call generateJokes(apiKey, subject, 5)
  //    b. Store in JokeCache via addJokesToCache
  // 5. Return summary: { generated: { 'death': 5 }, skipped: ['illness'] }
}
```

**Cache Refill Logic**:
- Threshold: Generate if unused count < 3
- Batch size: Generate 5 jokes per subject
- Cost optimization: Skip subjects with healthy cache

### Phase 2: Notification Integration

#### 2.1 Modify Send Notification
**File**: `api/send-notification.js` (MODIFY lines 33-41)

**Replace current joke API fetch with**:

```javascript
// 1. Fetch user settings (subjects) from UserSettings!F2
// 2. Select random subject from user's list
// 3. Try to get cached joke:
//    const jokes = await getCachedJokes(sheets, spreadsheetId, subject);
//    if (jokes.length > 0) {
//      const joke = jokes[Math.floor(Math.random() * jokes.length)];
//      await markJokeAsUsed(sheets, spreadsheetId, joke.rowIndex);
//      jokeText = joke.joke;
//    }
// 4. If cache miss, try OpenAI API (just-in-time fallback):
//    const apiKey = await getApiKeyFromSettings(sheets, spreadsheetId);
//    const newJokes = await generateJokes(apiKey, subject, 1);
//    jokeText = newJokes[0];
// 5. If API fails, use static fallback:
//    jokeText = getFallbackJoke(subject);
```

**Fallback Chain**:
1. JokeCache (unused jokes matching subject)
2. OpenAI API (just-in-time generation)
3. Static fallback (hardcoded jokes)

### Phase 3: Settings UI

#### 3.1 Add Joke Preferences Section
**File**: `src/components/Settings.jsx` (MODIFY)

**Add after Reminder Schedule section (before Push Notifications)**:

```jsx
<section className="settings-section">
  <h2>Dark Joke Preferences</h2>

  {/* Joke subjects - user will provide custom list */}
  <div className="form-group">
    <label>Joke Topics (one per line)</label>
    <textarea
      value={jokeSubjects}
      onChange={(e) => setJokeSubjects(e.target.value)}
      placeholder="death&#10;illness&#10;technology fails&#10;existential dread"
      rows={5}
    />
    <small>Enter topics for dark humor (e.g., death, illness, etc.)</small>
  </div>

  {/* OpenAI API key */}
  <div className="form-group">
    <label>OpenAI API Key</label>
    <input
      type="password"
      value={openaiApiKey}
      onChange={(e) => setOpenaiApiKey(e.target.value)}
      placeholder="sk-..."
    />
    <small>
      Your API key is stored securely and only used for joke generation.
      <a href="https://platform.openai.com/api-keys" target="_blank">Get API key</a>
    </small>
  </div>

  {/* Cache status display */}
  {cacheHealth && (
    <div className="cache-status">
      <h3>Joke Cache Status</h3>
      <ul>
        {Object.entries(cacheHealth).map(([subject, count]) => (
          <li key={subject}>
            {subject}: {count} unused jokes {count < 3 && '⚠️ Low'}
          </li>
        ))}
      </ul>
    </div>
  )}

  <button onClick={saveJokeSettings} disabled={settingsLoading}>
    Save Joke Settings
  </button>

  {/* Test generation button */}
  <button onClick={testJokeGeneration} disabled={settingsLoading}>
    Test Joke Generation
  </button>
</section>
```

**State Management**:
```javascript
const [jokeSubjects, setJokeSubjects] = useState('');
const [openaiApiKey, setOpenaiApiKey] = useState('');
const [cacheHealth, setCacheHealth] = useState(null);
```

#### 3.2 Update Notification Settings API
**File**: `api/notification-settings.js` (MODIFY)

**Extend UserSettings range** from `A2:D2` to `A2:G2`:
- Column A: firstReminderTime
- Column B: repeatInterval
- Column C: stopAfterLog
- Column D: snoozeUntil (existing)
- Column E: (reserved)
- **Column F**: jokeSubjects (JSON array: `["death","illness"]`)
- **Column G**: openaiApiKey (encrypted in transit via HTTPS)

**GET endpoint**: Return subjects as array, omit API key (security)
```javascript
return {
  firstReminderTime: row[0],
  repeatInterval: row[1],
  stopAfterLog: row[2],
  jokeSubjects: row[5] ? JSON.parse(row[5]) : [],
  hasApiKey: !!row[6]  // Boolean, don't expose actual key
};
```

**POST endpoint**: Accept and validate new fields
```javascript
const { firstReminderTime, repeatInterval, stopAfterLog, jokeSubjects, openaiApiKey } = req.body;

// Validate jokeSubjects is array of strings
if (!Array.isArray(jokeSubjects) || jokeSubjects.some(s => typeof s !== 'string')) {
  return res.status(400).json({ error: 'Invalid joke subjects format' });
}

// Update row with new columns F and G
await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: 'UserSettings!A2:G2',
  valueInputOption: 'RAW',
  resource: {
    values: [[
      firstReminderTime,
      repeatInterval,
      stopAfterLog,
      '', // Column D (snoozeUntil preserved separately)
      '', // Column E (reserved)
      JSON.stringify(jokeSubjects),
      openaiApiKey || ''
    ]]
  }
});
```

### Phase 4: Google Sheets Setup

#### 4.1 Create JokeCache Tab
**Columns**:
- A: Subject (e.g., "death", "illness")
- B: Joke (the actual joke text)
- C: GeneratedAt (timestamp)
- D: Used (TRUE/FALSE)
- E: UsedAt (timestamp when sent)

**Auto-creation**: `api/generate-jokes.js` will create tab if missing (similar to `api/subscribe.js` pattern)

### Phase 5: Cron Configuration

#### 5.1 Update vercel.json
**File**: `vercel.json` (MODIFY)

Add new cron job:
```json
{
  "crons": [
    {
      "path": "/api/generate-jokes",
      "schedule": "0 18 * * *"
    },
    {
      "path": "/api/cron-trigger",
      "schedule": "0 21 * * *"
    }
  ]
}
```

**Schedule**:
- 6 PM ET: Check cache health, generate if needed
- 9 PM ET: Send notifications with cached jokes

## Cost Analysis

**OpenAI API Costs** (gpt-4o-mini):
- Input: $0.15 per 1M tokens
- Output: $0.60 per 1M tokens

**Daily Usage (Worst Case)**:
- 4 subjects × 5 jokes = 20 API calls
- Input: 200 tokens/call × 20 = 4,000 tokens
- Output: 50 tokens/joke × 20 = 1,000 tokens
- Daily cost: $0.0006 input + $0.0006 output = **$0.0012/day**
- **Annual cost: ~$0.44/year**

**Typical Usage (Cache Hits)**:
- 2 subjects need refill × 5 jokes = 10 calls every 3-5 days
- **Annual cost: ~$0.10/year**

## Reliability Guarantees

### Fallback Chain (3 Layers)

1. **Primary: JokeCache** (Google Sheets)
   - Pre-generated jokes stored locally
   - Instant retrieval, no API latency
   - Works offline (for server)

2. **Secondary: OpenAI API** (Just-in-time)
   - If cache is empty, generate on-demand
   - 8-second timeout protection
   - 3 retry attempts

3. **Tertiary: Static Fallbacks** (Hardcoded)
   - Always available, no dependencies
   - Guaranteed to work even if everything fails

### Failure Scenarios Covered

| Scenario | Fallback Behavior |
|----------|-------------------|
| OpenAI API down | Use cached jokes (cache refill will retry next day) |
| API rate limit exceeded | Use cached jokes + static fallbacks |
| No internet connection | Use cached jokes from Google Sheets |
| Cache completely empty | OpenAI just-in-time → static fallback |
| Invalid API key | Skip generation, use static fallbacks |
| Vercel function timeout | Cache hit is instant, no timeout risk |

## Testing Plan

### Unit Tests
1. `generateJokes()` - Mock OpenAI API responses
2. `getCachedJokes()` - Mock Google Sheets data
3. `getFallbackJoke()` - Verify all subjects covered

### Integration Tests
1. End-to-end joke generation cron
2. Cache health check logic
3. Notification with all 3 fallback layers

### Manual Testing
1. Enable notifications with custom subjects
2. Verify cache populated after 6 PM cron
3. Send test notification, verify joke from cache
4. Manually empty cache, verify just-in-time fallback
5. Disable internet, verify static fallback

## Implementation Checklist

### Backend
- [ ] Create `api/helpers/openai-client.js` with retry logic
- [ ] Create `api/fallback-jokes.js` with 5-10 jokes per subject
- [ ] Create `api/helpers/joke-cache.js` for Sheets operations
- [ ] Create `api/generate-jokes.js` cron endpoint
- [ ] Modify `api/send-notification.js` lines 33-41 with fallback chain
- [ ] Modify `api/notification-settings.js` to handle F2:G2 range

### Frontend
- [ ] Add joke preferences section to `src/components/Settings.jsx`
- [ ] Add state management for subjects + API key
- [ ] Add cache health display component
- [ ] Add test generation button handler
- [ ] Add CSS styles for new sections in `src/components/Settings.css`

### Configuration
- [ ] Update `vercel.json` with 6 PM cron job
- [ ] Test cron schedules in Vercel dashboard

### Google Sheets
- [ ] Verify UserSettings tab columns A-G
- [ ] Auto-create JokeCache tab on first generation
- [ ] Add header row: Subject, Joke, GeneratedAt, Used, UsedAt

### Testing & Deployment
- [ ] Test locally with mock OpenAI responses
- [ ] Test all 3 fallback layers
- [ ] Deploy to Vercel
- [ ] Monitor cron logs for 3 days
- [ ] Verify cache refill only happens when needed

## File Summary

### New Files (7)
1. `api/helpers/openai-client.js` - OpenAI API wrapper
2. `api/fallback-jokes.js` - Static fallback jokes
3. `api/helpers/joke-cache.js` - Cache management
4. `api/generate-jokes.js` - Pre-generation cron

### Modified Files (4)
1. `api/send-notification.js` - Joke selection with fallback chain (lines 33-41)
2. `api/notification-settings.js` - Extend to columns F2:G2
3. `src/components/Settings.jsx` - Add joke preferences UI
4. `vercel.json` - Add 6 PM cron job

## Security Considerations

1. **API Key Storage**: Stored in Google Sheets UserSettings!G2
   - Encrypted in transit (HTTPS)
   - Not exposed in GET responses (returns `hasApiKey` boolean)
   - Only accessible via authenticated API calls

2. **Input Validation**: Sanitize user-provided subjects to prevent injection

3. **Rate Limiting**: Cache prevents excessive API usage

## Future Enhancements (Not in Scope)

1. Weekly cache cleanup cron (delete jokes > 30 days old)
2. Subject-specific joke quality rating system
3. Multi-provider fallback (Anthropic Claude as backup)
4. User-submitted custom jokes
5. Joke repetition tracking (never send same joke twice)

## Notes

- User will provide custom list of joke topics during implementation
- OpenAI API key will be provided during setup
- Cache health display helps user monitor system status
- Adaptive refill saves costs by only generating when needed
- Random subject rotation provides variety without complex UI

---

**Estimated Implementation Time**: 4-6 hours
**Estimated Annual Cost**: $0.10 - $0.44 (OpenAI API usage)
**Reliability**: 99.9%+ (3-layer fallback ensures notifications always work)
