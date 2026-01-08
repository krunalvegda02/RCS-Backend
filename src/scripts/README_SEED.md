# Test Data Seed Script

## Overview
This script populates your database with dummy test data for testing the Orders page and campaign functionality.

## What it creates:

### 2 Campaigns
1. **Campaign 1: "Test Campaign - Summer Sale"**
   - Status: Completed
   - 15 contacts
   - Stats: 12 delivered, 8 read, 3 replied, 3 failed

2. **Campaign 2: "Test Campaign - New Product Launch"**
   - Status: Pending
   - 15 contacts (same contacts as Campaign 1)
   - Stats: 8 delivered, 5 read, 2 replied, 2 failed

### 15 Test Contacts
- Phone numbers: 7201000001 to 7201000015
- Each contact has messages for both campaigns
- Various statuses: sent, delivered, read, replied, failed

## Prerequisites
- MongoDB running
- At least 1 user in database
- At least 1 template in database

## How to Run

```bash
cd BACKEND
npm run seed
```

## What happens:
1. ✅ Connects to MongoDB
2. ✅ Finds first user and template
3. ✅ Creates 2 campaigns
4. ✅ Creates 15 ContactCampaignMessage documents
5. ✅ Each contact has 2 campaign states (one per campaign)
6. ✅ Verifies data with aggregation query

## Expected Output:
```
🌱 Starting seed process...
✅ Connected to MongoDB
✅ Using user: user@example.com
✅ Using template: Welcome Message
✅ Generated 15 phone numbers

📊 Creating Campaign 1...
✅ Campaign 1 created: 507f1f77bcf86cd799439011

📊 Creating Campaign 2...
✅ Campaign 2 created: 507f1f77bcf86cd799439012

📱 Creating messages for Campaign 1...
✅ Created 15 messages for Campaign 1

📱 Creating messages for Campaign 2...
✅ Created 15 messages for Campaign 2

🔍 Verifying data...
✅ Total campaigns: 2
✅ Total contacts with messages: 15

🧪 Testing aggregation query...
Campaign 1 status breakdown: [
  { _id: 'delivered', count: 5 },
  { _id: 'read', count: 5 },
  { _id: 'replied', count: 3 },
  { _id: 'failed', count: 2 }
]

✅ Seed completed successfully!

📋 Summary:
   - Campaign 1: "Test Campaign - Summer Sale" (507f1f77bcf86cd799439011)
   - Campaign 2: "Test Campaign - New Product Launch" (507f1f77bcf86cd799439012)
   - Total contacts: 15
   - Phone numbers: 7201000001, 7201000002, 7201000003, 7201000004, 7201000005...
```

## Testing the Orders Page

After running the seed:

1. **Go to Orders page** (`/reports`)
2. **You should see:**
   - 2 campaigns in the list
   - Campaign 1 with "Completed" status
   - Campaign 2 with "Pending" status
   - Accurate delivered/failed counts
   - Success rate percentages

3. **Click "View" on Campaign 1:**
   - Modal opens
   - Shows 15 messages
   - Pagination works (10 per page)
   - Various statuses: delivered, read, replied, failed
   - Timestamps visible
   - Interactions and replies shown

4. **Click "View" on Campaign 2:**
   - Modal opens
   - Shows 15 messages
   - Mix of sent/delivered/read/replied statuses

5. **Test Filters:**
   - Search by phone number
   - Filter by status
   - Pagination between pages

6. **Test Export:**
   - Click "Export Messages" in modal
   - Excel file downloads with all 15 messages

## Data Structure

### Campaign Model
```javascript
{
  name: "Test Campaign - Summer Sale",
  userId: ObjectId,
  templateId: ObjectId,
  status: "completed",
  isArchived: false,
  stats: {
    total: 15,
    sent: 15,
    delivered: 12,
    read: 8,
    replied: 3,
    failed: 3
  }
}
```

### ContactCampaignMessage Model
```javascript
{
  recipientPhoneNumber: "7201000001",
  userId: ObjectId,
  campaignIds: [campaignId1, campaignId2],
  campaigns: [
    {
      campaignId: campaignId1,
      templateId: templateId,
      messageId: "msg-...",
      status: "delivered",
      sentAt: Date,
      deliveredAt: Date,
      readAt: Date,
      userClickCount: 2,
      userReplyCount: 0
    },
    {
      campaignId: campaignId2,
      templateId: templateId,
      messageId: "msg-...",
      status: "read",
      sentAt: Date,
      deliveredAt: Date,
      readAt: Date,
      userClickCount: 1,
      userReplyCount: 0
    }
  ]
}
```

## Cleanup

To remove test data:

```javascript
// In MongoDB shell or Compass
db.campaigns.deleteMany({ name: /^Test Campaign/ })
db.contact_campaign_messages.deleteMany({ recipientPhoneNumber: /^720100/ })
```

## Troubleshooting

**Error: No user found**
- Create a user first through registration

**Error: No template found**
- Create a template first through the templates page

**Error: Connection failed**
- Check MongoDB is running
- Check .env file has correct MONGODB_URI

## Notes

- Safe to run multiple times (will create duplicate campaigns)
- Uses real phone number format (10 digits)
- Timestamps are realistic (1-2 hours ago)
- Status distribution mimics real campaigns
- Each contact appears in both campaigns (realistic scenario)
