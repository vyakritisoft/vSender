# Graph Report - /Users/rra/Developer/Projects/chrome/vSender  (2026-04-25)

## Corpus Check
- 11 files · ~26,105 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 161 nodes · 347 edges · 15 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]

## God Nodes (most connected - your core abstractions)
1. `$()` - 32 edges
2. `log()` - 17 edges
3. `processQueue()` - 15 edges
4. `QueueEngine` - 15 edges
5. `handleMessage()` - 14 edges
6. `RateLimiter` - 14 edges
7. `Logger` - 13 edges
8. `sendMediaMessage()` - 9 edges
9. `sendTextMessage()` - 9 edges
10. `handleFile()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `dbg()` --calls--> `log()`  [INFERRED]
  /Users/rra/Developer/Projects/chrome/vSender/extension/src/content/contentScript.js → /Users/rra/Developer/Projects/chrome/vSender/extension/src/background/serviceWorker.js
- `refreshDatasetList()` --calls--> `getDatasets()`  [INFERRED]
  /Users/rra/Developer/Projects/chrome/vSender/extension/src/popup/popup.js → /Users/rra/Developer/Projects/chrome/vSender/extension/src/core/db/database.js
- `handleDatasetSelect()` --calls--> `getDatasetById()`  [INFERRED]
  /Users/rra/Developer/Projects/chrome/vSender/extension/src/popup/popup.js → /Users/rra/Developer/Projects/chrome/vSender/extension/src/core/db/database.js
- `handleFile()` --calls--> `parseFile()`  [INFERRED]
  /Users/rra/Developer/Projects/chrome/vSender/extension/src/popup/popup.js → /Users/rra/Developer/Projects/chrome/vSender/extension/src/core/parser/csvParser.js
- `handleFile()` --calls--> `saveDataset()`  [INFERRED]
  /Users/rra/Developer/Projects/chrome/vSender/extension/src/popup/popup.js → /Users/rra/Developer/Projects/chrome/vSender/extension/src/core/db/database.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.19
Nodes (28): broadcastStatus(), clearAllData(), ensureContentScriptInjected(), exportLogsCSV(), exportResultsCSV(), findWhatsAppTab(), getDelay(), getNextItem() (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.29
Nodes (16): dataURLtoFile(), dbg(), findFileInputForMime(), handleMessage(), handleOpenChat(), init(), injectBulkSenderButton(), isWhatsAppReady() (+8 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (1): QueueEngine

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (1): RateLimiter

### Community 4 - "Community 4"
Cohesion: 0.21
Nodes (7): fetchStatus(), handleDeleteDataset(), loadExistingStatus(), showConfirmToast(), updateControlStates(), updateLogsUI(), updateProgressUI()

### Community 5 - "Community 5"
Cohesion: 0.21
Nodes (1): Logger

### Community 6 - "Community 6"
Cohesion: 0.22
Nodes (13): buildSampleVariablesFromFile(), emptyValidationResult(), getValidationResultForCurrentMode(), initSettings(), loadSettingsUI(), resetFileState(), updateFieldMapping(), updateLaunchSummary() (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.2
Nodes (12): $(), addVariableMapping(), checkWhatsAppConnection(), initControls(), initDelay(), initMapping(), initMessage(), initStickyLayout() (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.39
Nodes (7): normalizePhone(), parseCSV(), parseCSVRecords(), parseCSVText(), parseFile(), parseXLSX(), validateAndMap()

### Community 9 - "Community 9"
Cohesion: 0.6
Nodes (5): deleteDataset(), getDatasetById(), getDatasets(), initDB(), saveDataset()

### Community 10 - "Community 10"
Cohesion: 0.6
Nodes (4): extractVariables(), previewTemplate(), renderTemplate(), validateTemplate()

### Community 11 - "Community 11"
Cohesion: 0.67
Nodes (4): handleDatasetSelect(), handleFile(), populateFieldMapping(), showToast()

### Community 12 - "Community 12"
Cohesion: 0.5
Nodes (4): capitalize(), getDefaultCountryCode(), startSending(), switchTab()

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 13`** (2 nodes): `xlsx.full.min.js`, `make_xlsx_lib()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (1 nodes): `README.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `Community 0` to `Community 1`, `Community 3`, `Community 5`?**
  _High betweenness centrality (0.381) - this node is a cross-community bridge._
- **Why does `refreshDatasetList()` connect `Community 7` to `Community 9`, `Community 11`, `Community 4`, `Community 5`?**
  _High betweenness centrality (0.283) - this node is a cross-community bridge._
- **Why does `handleFile()` connect `Community 11` to `Community 4`, `Community 5`, `Community 7`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.227) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `log()` (e.g. with `.error()` and `.warn()`) actually correct?**
  _`log()` has 5 INFERRED edges - model-reasoned connections that need verification._