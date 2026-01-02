# Wallet Blocked Balance Feature

## Problem Solved
User with ₹60K balance creates campaign of 50K messages → ₹50K should be BLOCKED → User cannot create another campaign with that ₹50K until first campaign completes.

## How It Works

### 1. Campaign Creation
```
User Balance: ₹60,000
Campaign: 50,000 messages

Action:
- Block ₹50,000 from wallet
- Available Balance = ₹60,000 - ₹50,000 = ₹10,000
- User can only create campaigns with ₹10,000 now
```

### 2. Message Delivery
```
Webhook receives "MESSAGE_DELIVERED":
- Deduct ₹1 from actual balance
- Unblock ₹1 from blocked balance
- Increment campaign actualCost by ₹1

Result:
- Balance: ₹59,999
- Blocked: ₹49,999
- Available: ₹10,000 (stays same)
```

### 3. Message Failure
```
Webhook receives "SEND_MESSAGE_FAILURE":
- NO deduction from balance
- Unblock ₹1 from blocked balance
- User gets refund automatically

Result:
- Balance: ₹60,000 (unchanged)
- Blocked: ₹49,999
- Available: ₹10,001 (increased by ₹1)
```

### 4. Campaign Completion
```
All messages processed:
- Delivered: 48,000 → Charged ₹48,000
- Failed: 2,000 → Refunded ₹2,000
- Blocked balance automatically becomes ₹0

Final:
- Balance: ₹12,000 (60K - 48K)
- Blocked: ₹0
- Available: ₹12,000
```

## Database Changes

### User Model
```javascript
wallet: {
  balance: Number,           // Total balance
  blockedBalance: Number,    // Amount blocked for campaigns
  // availableBalance = balance - blockedBalance
}
```

### Campaign Model
```javascript
{
  estimatedCost: Number,     // Expected cost (50,000)
  actualCost: Number,        // Real cost charged (48,000)
  blockedAmount: Number      // Amount blocked (50,000)
}
```

## New Methods

### User Model
- `blockBalance(amount, campaignId)` - Block amount for campaign
- `unblockBalance(amount)` - Unblock amount
- `getAvailableBalance()` - Get balance - blockedBalance

## API Response Changes

### GET /api/auth/profile
```json
{
  "wallet": {
    "balance": 60000,
    "blockedBalance": 50000,
    "availableBalance": 10000,
    "currency": "INR"
  }
}
```

### POST /api/campaigns (Error)
```json
{
  "success": false,
  "message": "Insufficient available balance",
  "required": 50000,
  "available": 10000,
  "totalBalance": 60000,
  "blockedBalance": 50000
}
```

## Flow Example

**Scenario: User has ₹60K, creates 2 campaigns**

1. **Campaign 1: 50K messages**
   - Block ₹50K
   - Available: ₹10K
   - Status: Running

2. **Try Campaign 2: 20K messages**
   - Required: ₹20K
   - Available: ₹10K
   - ❌ ERROR: Insufficient available balance

3. **Campaign 1 completes**
   - 48K delivered → Charged ₹48K
   - 2K failed → Refunded ₹2K
   - Unblocked: ₹50K
   - New Balance: ₹12K
   - Available: ₹12K

4. **Now Campaign 2: 10K messages**
   - Required: ₹10K
   - Available: ₹12K
   - ✅ SUCCESS: Campaign created

## Benefits
✅ Prevents double-spending of same balance
✅ Automatic refund for failed messages
✅ Real-time available balance tracking
✅ Fair billing - pay only for delivered
✅ Multiple campaigns can't use same blocked amount
