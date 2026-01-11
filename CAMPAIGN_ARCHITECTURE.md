# Campaign Architecture: Master & Sub-Campaign System

## Overview
The system supports two campaign modes:
- **Master Campaign**: For < 1000 contacts (single campaign)
- **Sub-Campaign**: For ≥ 1000 contacts (1 master + 30 sub-campaigns)

## Data Structure

### Campaign Model
```javascript
{
  _id: ObjectId,
  name: String,
  userId: ObjectId,
  templateId: ObjectId,
  
  // Master/Sub Structure
  isMaster: Boolean,           // true = master campaign, false/undefined = regular/sub
  masterCampaignId: ObjectId,  // Points to master (only for sub-campaigns)
  subCampaignIndex: Number,    // 0-29 for sub-campaigns
  
  status: 'draft' | 'pending' | 'processing' | 'running' | 'completed' | 'failed',
  stats: { total, sent, delivered, read, replied, failed, bounced }
}
```

### Message Model
```javascript
{
  recipientPhoneNumber: String,
  userId: ObjectId,
  campaignIds: [ObjectId],     // Array of all campaign IDs this contact belongs to
  
  campaigns: [{
    campaignId: ObjectId,      // Can be master OR sub-campaign ID
    templateId: ObjectId,
    messageId: String (UUID),
    status: 'draft' | 'queued' | 'sent' | 'delivered' | 'failed' | ...,
    sentAt: Date,
    deliveredAt: Date,
    // ... other fields
  }]
}
```

## Message Flow

### 1. Campaign Creation (< 1000 contacts)
```
createCampaignEntries()
  ↓
Creates 1 campaign (isMaster: false)
  ↓
Creates messages with campaignId = campaign._id
```

### 2. Campaign Creation (≥ 1000 contacts)
```
createCampaignEntries(createSubCampaigns: true)
  ↓
Creates 1 master campaign (isMaster: true)
  ↓
Creates 30 sub-campaigns (masterCampaignId: master._id)
  ↓
Splits contacts into 30 chunks
  ↓
Creates messages with campaignId = subCampaign._id
```

### 3. Sending Messages
```
sendCampaign(campaignId)
  ↓
campaignSender.service.js
  ↓
Checks if campaign.isMaster === true
  ↓
If master: Gets all sub-campaign IDs
If regular: Uses single campaignId
  ↓
Queries messages: { 'campaigns.campaignId': { $in: campaignIds } }
  ↓
Sends to Kafka with ACTUAL campaignId (sub-campaign ID, not master)
  ↓
Updates status: draft → queued
```

### 4. Message Sending (Kafka Workers)
```
messageSender.js (10 workers)
  ↓
Reads from 'rcs-messages' topic
  ↓
Sends to Jio API
  ↓
Updates message: { 'campaigns.campaignId': campaignId }
  ↓
Calls checkCampaignCompletion(campaignId)
  ↓
If sub-campaign completes → checkMasterCampaignCompletion()
```

### 5. Campaign Completion Logic

#### Sub-Campaign Completion
```javascript
checkCampaignCompletion(subCampaignId)
  ↓
Counts pending messages for this sub-campaign
  ↓
If pending === 0:
  - Mark sub-campaign as 'completed'
  - Call checkMasterCampaignCompletion(masterCampaignId)
```

#### Master Campaign Completion
```javascript
checkMasterCampaignCompletion(masterCampaignId)
  ↓
Counts sub-campaigns with status NOT IN ['completed', 'failed']
  ↓
If pendingSubCampaigns === 0:
  - Mark master campaign as 'completed'
```

## Key Design Decisions

### ✅ Why Messages Store Sub-Campaign IDs (Not Master IDs)
1. **Granular Tracking**: Each sub-campaign can be tracked independently
2. **Parallel Processing**: 30 sub-campaigns can complete independently
3. **Accurate Stats**: Stats are aggregated from sub-campaigns to master
4. **Worker Efficiency**: Workers don't need to know about master/sub structure

### ✅ Why CampaignSender Detects Master Campaigns
1. **Single Entry Point**: Frontend calls sendCampaign(masterCampaignId)
2. **Automatic Discovery**: Backend finds all sub-campaigns automatically
3. **Unified Logic**: Same code handles both master and regular campaigns

### ✅ Why Completion Checks Both Levels
1. **Sub-Campaign**: Completes when its messages are done
2. **Master Campaign**: Completes when ALL sub-campaigns are done
3. **Cascading Updates**: Sub-campaign completion triggers master check

## Performance Characteristics

### Small Campaigns (< 1000 contacts)
- **Structure**: 1 campaign, N messages
- **Completion**: Single query checks all messages
- **Speed**: ~100-500ms to complete

### Large Campaigns (≥ 1000 contacts)
- **Structure**: 1 master + 30 sub-campaigns, N messages
- **Completion**: 30 parallel checks + 1 master check
- **Speed**: ~1-3 seconds to complete (all sub-campaigns)
- **Parallelism**: 30 sub-campaigns can complete simultaneously

## Database Queries

### Query Messages (Master Campaign)
```javascript
// CampaignSender automatically expands to sub-campaigns
const subCampaigns = await Campaign.find({ masterCampaignId: campaignId });
const campaignIds = subCampaigns.map(s => s._id);

const messages = await ContactCampaignMessage.find({
  'campaigns.campaignId': { $in: campaignIds },
  'campaigns.status': 'draft'
});
```

### Update Message Status
```javascript
// Works for both master and sub-campaigns
await ContactCampaignMessage.updateOne(
  { 
    'campaigns.messageId': messageId,
    'campaigns.campaignId': campaignId  // Actual campaign ID (sub or regular)
  },
  { 
    $set: { 
      'campaigns.$.status': 'sent',
      'campaigns.$.sentAt': new Date()
    }
  }
);
```

### Check Campaign Completion
```javascript
// Sub-campaign completion
const result = await ContactCampaignMessage.aggregate([
  { $match: { 'campaigns.campaignId': subCampaignId } },
  { $unwind: '$campaigns' },
  { $match: { 'campaigns.campaignId': subCampaignId } },
  { $group: { _id: null, pending: { $sum: ... } } }
]);

// Master campaign completion
const pendingSubCampaigns = await Campaign.countDocuments({
  masterCampaignId: masterCampaignId,
  status: { $nin: ['completed', 'failed'] }
});
```

## Testing Checklist

### ✅ Small Campaign (< 1000 contacts)
- [ ] Creates single campaign (isMaster: false)
- [ ] Messages have correct campaignId
- [ ] Sends all messages to Kafka
- [ ] Updates message status correctly
- [ ] Completes campaign when all messages done

### ✅ Large Campaign (≥ 1000 contacts)
- [ ] Creates 1 master + 30 sub-campaigns
- [ ] Messages distributed across sub-campaigns
- [ ] Sends all messages with correct sub-campaign IDs
- [ ] Sub-campaigns complete independently
- [ ] Master campaign completes when all sub-campaigns done
- [ ] Stats aggregate correctly from sub to master

## Troubleshooting

### Issue: "Found 0 draft messages"
**Cause**: CampaignSender looking for master campaign ID, but messages have sub-campaign IDs
**Fix**: ✅ CampaignSender now detects master campaigns and queries all sub-campaign IDs

### Issue: Master campaign never completes
**Cause**: Sub-campaigns complete but don't trigger master completion check
**Fix**: ✅ Added checkMasterCampaignCompletion() in messageSender.js and retryProcessor.js

### Issue: Messages not sending for large campaigns
**Cause**: MongoDB SSL errors during bulk write (createCampaignEntries)
**Fix**: ✅ Reduced CHUNK_SIZE from 2000 to 1000, CONCURRENCY to 3, added retry logic
