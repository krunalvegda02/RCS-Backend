# Wallet Deduction Fix - Pay Per Delivery

## Problem
- Wallet was deducted UPFRONT when campaign started
- User charged ₹100 for 100 messages even if only 50 delivered
- No refund for failed messages

## Solution
- Wallet now deducted ₹1 per message ONLY on successful delivery
- Webhook receives "MESSAGE_DELIVERED" → deduct ₹1
- Failed messages = no charge

## Changes Made

### 1. campaign.controller.js
- **REMOVED**: Upfront wallet deduction (line 186-190)
- **UPDATED**: Balance check message to clarify pay-per-delivery
- **UPDATED**: actualCost comment - incremented per delivery

### 2. webhook.controller.js  
- **ADDED**: Wallet deduction in MESSAGE_DELIVERED case
- **ADDED**: Campaign actualCost increment on delivery
- **LOGIC**: 
  ```javascript
  case "MESSAGE_DELIVERED":
    // Get user from message
    // Deduct ₹1 from wallet
    // Increment campaign actualCost by 1
  ```

## How It Works Now

1. **Campaign Creation**
   - Check if user has sufficient balance
   - NO deduction yet
   - Campaign starts sending

2. **Message Sent**
   - Message sent to Jio RCS
   - Status: "sent"
   - Still no charge

3. **Delivery Webhook Received**
   - Jio sends "MESSAGE_DELIVERED" webhook
   - ✅ Deduct ₹1 from user wallet
   - ✅ Increment campaign actualCost by 1
   - Transaction recorded with description

4. **Failed Messages**
   - No delivery webhook = no charge
   - User only pays for successful deliveries

## Benefits
✅ Fair billing - pay only for delivered messages
✅ Automatic refund for failed messages (never charged)
✅ Real-time cost tracking in campaign.actualCost
✅ Transaction history shows per-message deductions

## Testing
1. Create campaign with 10 recipients
2. Check wallet balance before
3. Wait for deliveries
4. Check wallet transactions - should see 10 separate ₹1 deductions
5. Check campaign.actualCost - should match delivered count
