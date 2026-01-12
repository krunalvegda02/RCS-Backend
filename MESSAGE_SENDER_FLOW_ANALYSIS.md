# Message Sender Flow Analysis

## ✅ CURRENT FLOW IS WORKING CORRECTLY

### Flow Overview
```
Campaign Creation → ContactCampaignMessage (DB) → Kafka Queue → Message Sender Worker → Jio API
                                                                        ↓
                                                                  DB Writer (batched)
```

## Master Campaign & Sub-Campaign Compatibility ✅

### 1. Campaign Creation Flow
**Master Campaign:**
- `isMaster: true`
- Creates 30 sub-campaigns automatically
- Each sub-campaign: `masterCampaignId` points to master
- Sub-campaigns named: `bot1`, `bot2`, ..., `bot30`

**Sub-Campaign:**
- `isMaster: false`
- `masterCampaignId: <master_id>`
- `subCampaignIndex: 0-29`

### 2. Message Entry Creation ✅
**Location:** `campaign.controller.js` → `createCampaignEntries()`

```javascript
// For each sub-campaign
ContactCampaignMessage.bulkWrite([{
  updateOne: {
    filter: { recipientPhoneNumber: cleanPhone, userId },
    update: {
      $push: {
        campaigns: {
          campaignId: subCampaign._id,  // ✅ Uses sub-campaign ID
          templateId,
          messageId: uuidv4(),
          status: "draft"
        }
      }
    }
  }
}])
```

**Result:** Each contact has campaign entry with **sub-campaign ID**, not master ID.

### 3. Campaign Sender Service ✅
**Location:** `campaignSender.service.js` → `sendCampaignMessages()`

```javascript
// If master campaign, get all sub-campaign IDs
let campaignIds = [campaignId];
if (campaign.isMaster) {
  const subCampaigns = await Campaign.find({ masterCampaignId: campaignId });
  campaignIds = subCampaigns.map(s => s._id);
}

// Query messages for ALL sub-campaigns
ContactCampaignMessage.find({
  userId,
  campaignIds: { $in: campaignIds },  // ✅ Matches sub-campaign IDs
  'campaigns.status': 'draft'
})
```

**Result:** Correctly fetches messages for all sub-campaigns.

### 4. Message Sender Worker ✅
**Location:** `messageSender.js`

```javascript
// Receives from Kafka
{
  messageId: "uuid",
  phoneNumber: "+919876543210",
  userId: "user_id",
  campaignId: "sub_campaign_id",  // ✅ Sub-campaign ID
  templateId: "template_id",
  content: { ... }
}

// Sends to Jio API
// Updates DB via Kafka (dbWriter)
sendDBUpdateToKafka({
  messageId,
  campaignId,  // ✅ Sub-campaign ID preserved
  fields: {
    'campaigns.$.status': 'sent',
    'campaigns.$.sentAt': new Date()
  }
})
```

### 5. DB Writer Worker ✅
**Location:** `dbWriter.js`

```javascript
// Batches updates
bulkOps.push({
  updateOne: {
    filter: { 
      'campaigns.messageId': messageId,
      'campaigns.campaignId': campaignId  // ✅ Matches sub-campaign ID
    },
    update: { $set: fields }
  }
})
```

### 6. Stats Aggregation ✅
**Location:** `campaign.model.js`

```javascript
// Sub-campaign syncs its own stats
campaign.syncStats() // Aggregates from ContactCampaignMessage

// Master campaign syncs from all sub-campaigns
campaign.syncMasterStats() // Aggregates from sub-campaigns
```

## Data Flow Verification ✅

### ContactCampaignMessage Schema
```javascript
{
  recipientPhoneNumber: "9876543210",
  userId: ObjectId("user_id"),
  campaignIds: [ObjectId("sub_campaign_1"), ObjectId("sub_campaign_2")],
  campaigns: [
    {
      campaignId: ObjectId("sub_campaign_1"),  // ✅ Sub-campaign ID
      templateId: ObjectId("template_id"),
      messageId: "uuid-1",
      status: "sent",
      sentAt: Date,
      jioMessageId: "jio_msg_id"
    }
  ]
}
```

### Kafka Message Format
```javascript
{
  messageId: "uuid-1",
  phoneNumber: "+919876543210",
  userId: "user_id",
  campaignId: "sub_campaign_1",  // ✅ Sub-campaign ID
  templateId: "template_id",
  templateType: "richCard",
  content: { content: { richCardDetails: {...} } },
  retryCount: 0
}
```

## Compatibility Matrix ✅

| Component | Master Campaign | Sub-Campaign | Status |
|-----------|----------------|--------------|--------|
| Campaign Creation | Creates master + 30 subs | Individual sub created | ✅ |
| Message Entry | N/A (uses subs) | campaignId = sub ID | ✅ |
| Campaign Sender | Fetches all sub IDs | Sends with sub ID | ✅ |
| Kafka Queue | N/A | campaignId = sub ID | ✅ |
| Message Sender | N/A | Uses sub ID | ✅ |
| DB Writer | N/A | Updates with sub ID | ✅ |
| Stats Sync | Aggregates from subs | Syncs own stats | ✅ |
| Webhook Updates | N/A | Matches sub ID | ✅ |

## Potential Issues & Fixes

### ⚠️ Issue 1: Campaign Status Updates
**Problem:** When sub-campaigns complete, master status may not update automatically.

**Current Fix:** `campaign.model.js` has `syncMasterStats()` method that updates master status.

**Recommendation:** Call `syncMasterStats()` after each sub-campaign completes:
```javascript
// In webhook or completion handler
if (subCampaign.status === 'completed') {
  const master = await Campaign.findById(subCampaign.masterCampaignId);
  if (master) await master.syncMasterStats();
}
```

### ⚠️ Issue 2: Retry Messages
**Current:** Retry messages preserve `campaignId` (sub-campaign ID) ✅

**Verification:**
```javascript
// retryProcessor.js
retryProducer.send({
  topic: retryTopic,
  messages: [{
    value: JSON.stringify({
      ...retryData,  // ✅ Preserves original campaignId
      retryCount: retryData.retryCount + 1
    })
  }]
})
```

## Performance Optimizations ✅

### 1. Batch Processing
- Campaign sender: 10,000 messages/batch
- DB writer: 500 updates/batch or 200ms flush
- Kafka: Fire-and-forget sends

### 2. Parallel Processing
- 30 sub-campaigns process simultaneously
- Each sub-campaign: independent Kafka partition
- No blocking between sub-campaigns

### 3. Rate Limiting
- Global Redis-backed limiter (66 TPS)
- Shared across all workers
- Prevents Jio API throttling

## Conclusion

✅ **Message sender flow is FULLY COMPATIBLE with master/sub-campaign structure**

**Key Points:**
1. Sub-campaign IDs are used throughout the entire flow
2. Master campaigns aggregate stats from sub-campaigns
3. No data loss or ID mismatch issues
4. Retry logic preserves campaign context
5. DB updates correctly target sub-campaign entries

**No changes needed to message sender flow for master/sub-campaign compatibility.**
