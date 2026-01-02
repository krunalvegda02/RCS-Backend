# Final Wallet Flow - Deduct Upfront, Refund on Failure

## How It Works Now

### 1. Campaign Creation (Upfront Deduction)
```
User Balance: ₹100
Campaign: 50 messages

Action:
- Deduct ₹50 immediately from wallet
- Balance becomes ₹50
- blockedAmount = ₹50 (for tracking)
```

### 2. Message Delivered (Track Only)
```
Webhook receives "MESSAGE_DELIVERED":
- Increment campaign.actualCost by ₹1
- NO wallet change (already deducted)

Result:
- Balance: ₹50 (unchanged)
- actualCost: ₹1 (tracking)
```

### 3. Message Failed (Refund)
```
Webhook receives "SEND_MESSAGE_FAILURE":
- Refund ₹1 to wallet
- Add transaction: "Refund for failed message"

Result:
- Balance: ₹51 (refunded ₹1)
- User gets money back automatically
```

### 4. Campaign Completion
```
Campaign completes:
- 45 delivered → Charged ₹45 (already deducted)
- 5 failed → Refunded ₹5 (via webhook)

Final:
- Deducted upfront: ₹50
- Refunded: ₹5
- Net charge: ₹45
- Final balance: ₹55
```

## Example Scenario

**Initial State:**
- User balance: ₹100
- Campaign: 10 messages

**Step 1: Campaign Created**
```
Deduct ₹10 upfront
Balance: ₹90
blockedAmount: ₹10
actualCost: ₹0
```

**Step 2: Messages Processing**
```
Message 1: Delivered → actualCost = ₹1, Balance = ₹90
Message 2: Delivered → actualCost = ₹2, Balance = ₹90
Message 3: Failed → Refund ₹1, actualCost = ₹2, Balance = ₹91
Message 4: Delivered → actualCost = ₹3, Balance = ₹91
...
Message 10: Delivered → actualCost = ₹9, Balance = ₹91
```

**Step 3: Campaign Completed**
```
blockedAmount: ₹10 (deducted upfront)
actualCost: ₹9 (9 delivered)
Refunded: ₹1 (1 failed)
Final Balance: ₹91
```

## Database Changes

### Campaign Model
```javascript
{
  blockedAmount: 10,    // Amount deducted upfront
  actualCost: 9,        // Actual delivered count
  estimatedCost: 10     // Expected cost
}
```

### User Wallet
```javascript
{
  balance: 91,          // Current balance
  blockedBalance: 0,    // Not used anymore
  transactions: [
    { type: 'debit', amount: 10, description: 'Campaign "Test" - 10 messages' },
    { type: 'credit', amount: 1, description: 'Refund for failed message: xxx' }
  ]
}
```

## Webhook Actions

### MESSAGE_DELIVERED
- ✅ Increment campaign.actualCost
- ❌ No wallet change

### SEND_MESSAGE_FAILURE
- ✅ Refund ₹1 to wallet
- ✅ Add credit transaction

### Campaign Completion
- ✅ Update user stats
- ❌ No wallet change (already handled)

## Benefits
✅ Simple flow - deduct once, refund failures
✅ User pays only for delivered messages
✅ Automatic refunds via webhook
✅ Clear transaction history
✅ No complex blocking/unblocking logic

## Transaction Examples

**Successful Campaign (10/10 delivered):**
```
Debit: ₹10 - Campaign "Test" - 10 messages
Net: -₹10
```

**Partial Success (7/10 delivered):**
```
Debit: ₹10 - Campaign "Test" - 10 messages
Credit: ₹1 - Refund for failed message: msg1
Credit: ₹1 - Refund for failed message: msg2
Credit: ₹1 - Refund for failed message: msg3
Net: -₹7
```
