import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    // Basic Information
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
      index: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      match: [/^[0-9]{10}$/, 'Phone number must be 10 digits'],
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't include password in queries by default
    },

    // Company Information
    companyname: {
      type: String,
      trim: true,
      maxlength: [200, 'Company name cannot exceed 200 characters'],
    },

    // Role & Permissions
    role: {
      type: String,
      enum: ['USER', 'ADMIN'],
      default: 'USER',
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },

    // Jio RCS Configuration
    jioConfig: {
      clientId: {
        type: String,
        trim: true,
      },
      clientSecret: {
        type: String,
        trim: true,
        select: false, // Keep secret secure
      },
      assistantId: {
        type: String,
        trim: true,
      },
      isConfigured: {
        type: Boolean,
        default: false,
      },
    },

    // Wallet & Billing
    wallet: {
      balance: {
        type: Number,
        default: 0,
        min: 0,
      },
      blockedBalance: {
        type: Number,
        default: 0,
        min: 0,
      },
      currency: {
        type: String,
        default: 'INR',
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
      transactions: [{
        type: {
          type: String,
          enum: ['credit', 'debit'],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        balanceAfter: {
          type: Number,
          required: true,
        },
        description: {
          type: String,
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        processedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      }],
    },

    // Usage Statistics
    stats: {
      totalCampaigns: {
        type: Number,
        default: 0,
      },
      totalMessagesSent: {
        type: Number,
        default: 0,
      },
      totalMessagesDelivered: {
        type: Number,
        default: 0,
      },
      totalSpent: {
        type: Number,
        default: 0,
      },
      successRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      lastCampaignAt: Date,
    },

    // Rate Limiting
    // rateLimits: {
    //   messagesPerDay: {
    //     type: Number,
    //     default: 10000,
    //   },
    //   campaignsPerDay: {
    //     type: Number,
    //     default: 50,
    //   },
    //   currentDayUsage: {
    //     messages: {
    //       type: Number,
    //       default: 0,
    //     },
    //     campaigns: {
    //       type: Number,
    //       default: 0,
    //     },
    //     lastReset: {
    //       type: Date,
    //       default: Date.now,
    //     },
    //   },
    // },

    // Security
    lastLogin: Date,
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    emailVerificationToken: String,
    emailVerificationExpires: Date,

    // Audit
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    collection: 'users',
    timestamps: true, // This will automatically add createdAt and updatedAt
  }
);

// Indexes for performance
userSchema.index({ email: 1, isActive: 1 });
userSchema.index({ phone: 1, isActive: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ createdAt: -1 });

// Virtual for account lock status
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware to hash password
userSchema.pre('save', async function (next) {
  // Only hash password if it's modified
  if (!this.isModified('password')) return next();

  try {
    // Hash password with cost of 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to update jioConfig.isConfigured
userSchema.pre('save', function (next) {
  if (this.isModified('jioConfig')) {
    this.jioConfig.isConfigured = !!(
      this.jioConfig.clientId && 
      this.jioConfig.clientSecret
    );
  }
  next();
});

// Instance Methods
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(String(candidatePassword), this.password);
};

userSchema.methods.incrementLoginAttempts = async function () {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }

  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
    $set: { lastLogin: new Date() },
  });
};

userSchema.methods.updateWallet = async function (amount, operation = 'add', description = '', processedBy = null) {
  const currentBalance = this.wallet.balance || 0;
  let newBalance;
  
  if (operation === 'add') {
    newBalance = currentBalance + Math.abs(amount);
  } else if (operation === 'subtract') {
    if (currentBalance < Math.abs(amount)) {
      throw new Error('Insufficient wallet balance');
    }
    newBalance = currentBalance - Math.abs(amount);
  }
  
  // Add transaction record
  const transaction = {
    type: operation === 'add' ? 'credit' : 'debit',
    amount: Math.abs(amount),
    balanceAfter: newBalance,
    description: description || `Wallet ${operation === 'add' ? 'credited' : 'debited'} by admin`,
    processedBy: processedBy,
    createdAt: new Date(),
  };
  
  this.wallet.transactions.push(transaction);
  this.wallet.balance = newBalance;
  this.wallet.lastUpdated = new Date();
  
  await this.save();
  return this.wallet.balance;
};

userSchema.methods.addTransactionRecord = async function (type, amount, description, processedBy = null) {
  const transaction = {
    type: type,
    amount: Math.abs(amount),
    balanceAfter: this.wallet.balance,
    description: description,
    processedBy: processedBy,
    createdAt: new Date(),
  };
  
  this.wallet.transactions.push(transaction);
  await this.save();
  return transaction;
};

userSchema.methods.recalculateStatsOnCampaignCompletion = async function (campaignId) {
  const Campaign = mongoose.model('Campaign');
  const Message = mongoose.model('Message');
  
  // Get campaign data
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return;
  
  // Get actual message statistics from Message collection
  const messageStats = await Message.aggregate([
    { $match: { campaignId: new mongoose.Types.ObjectId(campaignId) } },
    {
      $group: {
        _id: null,
        totalSent: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'bounced']] }, 1, 0] } },
        read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
        replied: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } }
      }
    }
  ]);
  
  const stats = messageStats[0] || { totalSent: 0, delivered: 0, failed: 0, read: 0, replied: 0 };
  
  // Update user stats with accurate data
  this.stats.totalMessagesSent += stats.totalSent;
  this.stats.totalMessagesDelivered = (this.stats.totalMessagesDelivered || 0) + stats.delivered;
  this.stats.totalSpent += campaign.actualCost || 0;
  this.stats.lastCampaignAt = new Date();
  
  // Recalculate overall success rate
  if (this.stats.totalMessagesSent > 0) {
    this.stats.successRate = Math.round((this.stats.totalMessagesDelivered / this.stats.totalMessagesSent) * 100);
  }
  
  await this.save();
  
  return {
    campaignStats: stats,
    userStats: this.stats
  };
};

userSchema.methods.updateMessageStats = async function (deliveredCount = 0, failedCount = 0) {
  // Update delivered message count
  if (deliveredCount > 0) {
    this.stats.totalMessagesDelivered = (this.stats.totalMessagesDelivered || 0) + deliveredCount;
  }
  
  // Recalculate success rate
  if (this.stats.totalMessagesSent > 0) {
    this.stats.successRate = Math.round((this.stats.totalMessagesDelivered / this.stats.totalMessagesSent) * 100);
  }
  
  await this.save();
};

userSchema.methods.updateStats = async function (campaignData) {
  // Increment campaign count
  this.stats.totalCampaigns += 1;
  
  // Update message counts
  const messagesSent = campaignData.messagesSent || campaignData.totalMessages || 0;
  const messagesDelivered = campaignData.messagesDelivered || campaignData.successCount || 0;
  const messagesFailed = campaignData.messagesFailed || campaignData.failedCount || 0;
  
  this.stats.totalMessagesSent += messagesSent;
  this.stats.totalSpent += campaignData.cost || campaignData.actualCost || 0;
  this.stats.lastCampaignAt = new Date();
  
  // Calculate overall success rate based on total delivered vs total sent
  if (this.stats.totalMessagesSent > 0) {
    // Get total delivered messages across all campaigns
    const totalDelivered = this.stats.totalMessagesDelivered || 0;
    const newTotalDelivered = totalDelivered + messagesDelivered;
    
    // Store total delivered for future calculations
    this.stats.totalMessagesDelivered = newTotalDelivered;
    
    // Calculate success rate as percentage
    this.stats.successRate = Math.round((newTotalDelivered / this.stats.totalMessagesSent) * 100);
  } else {
    this.stats.successRate = 0;
  }
  
  await this.save();
};

userSchema.methods.checkRateLimit = function (type = 'messages') {
  // Rate limits are commented out, return true for now
  return true;
};

userSchema.methods.incrementUsage = async function (type = 'messages', count = 1) {
  // Rate limits are commented out, no-op for now
  return;
};

// Block wallet balance for campaign (deduct from wallet immediately)
userSchema.methods.blockBalance = async function (amount, campaignId) {
  if (this.wallet.balance < amount) {
    throw new Error('Insufficient wallet balance');
  }
  
  this.wallet.balance -= amount;
  this.wallet.blockedBalance = (this.wallet.blockedBalance || 0) + amount;
  this.wallet.lastUpdated = new Date();
  
  await this.save();
  return this.wallet.blockedBalance;
};

// Unblock wallet balance (on campaign completion or failure)
userSchema.methods.unblockBalance = async function (amount) {
  this.wallet.blockedBalance = Math.max(0, (this.wallet.blockedBalance || 0) - amount);
  this.wallet.lastUpdated = new Date();
  
  await this.save();
  return this.wallet.blockedBalance;
};

// Get available balance (total - blocked)
userSchema.methods.getAvailableBalance = function () {
  return this.wallet.balance - (this.wallet.blockedBalance || 0);
};

// Cleanup stuck blocked balance for completed/failed campaigns
userSchema.methods.cleanupBlockedBalance = async function () {
  const Campaign = mongoose.model('Campaign');
  
  // Find all completed/failed campaigns for this user
  const campaigns = await Campaign.find({
    userId: this._id,
    status: { $in: ['completed', 'failed'] },
    blockedAmount: { $gt: 0 }
  });
  
  let totalToUnblock = 0;
  
  for (const campaign of campaigns) {
    const remainingBlocked = campaign.blockedAmount - (campaign.actualCost || 0);
    if (remainingBlocked > 0) {
      totalToUnblock += remainingBlocked;
      console.log(`[Cleanup] Campaign ${campaign._id}: Blocked ₹${campaign.blockedAmount}, Actual ₹${campaign.actualCost}, To unblock ₹${remainingBlocked}`);
    }
  }
  
  if (totalToUnblock > 0) {
    await this.unblockBalance(totalToUnblock);
    console.log(`[Cleanup] Total unblocked for user ${this._id}: ₹${totalToUnblock}`);
  }
  
  return {
    campaignsChecked: campaigns.length,
    amountUnblocked: totalToUnblock,
    newBlockedBalance: this.wallet.blockedBalance
  };
};

// Static method to cleanup all users' stuck blocked balances
userSchema.statics.cleanupAllBlockedBalances = async function () {
  const users = await this.find({ 'wallet.blockedBalance': { $gt: 0 } });
  const results = [];
  
  for (const user of users) {
    try {
      const result = await user.cleanupBlockedBalance();
      if (result.amountUnblocked > 0) {
        results.push({
          userId: user._id,
          email: user.email,
          ...result
        });
      }
    } catch (error) {
      console.error(`Error cleaning up user ${user._id}:`, error);
    }
  }
  
  return results;
};

// Static Methods
userSchema.statics.findByEmailOrPhone = function (identifier) {
  return this.findOne({
    $or: [
      { email: String(identifier) },
      { phone: String(identifier) }
    ],
    isActive: true,
  }).select('+password');
};

userSchema.statics.createUser = async function (userData) {
  const user = new this(userData);
  await user.save();
  
  // Remove password from returned object
  const userObject = user.toObject();
  delete userObject.password;
  if (userObject.jioConfig) {
    delete userObject.jioConfig.clientSecret;
  }
  
  return userObject;
};

// Transform output to remove sensitive data
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.password;
  if (userObject.jioConfig) {
    delete userObject.jioConfig.clientSecret;
  }
  delete userObject.passwordResetToken;
  delete userObject.emailVerificationToken;
  return userObject;
};

export default mongoose.model('User', userSchema);