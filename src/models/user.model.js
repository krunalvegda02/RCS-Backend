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
    rateLimits: {
      messagesPerDay: {
        type: Number,
        default: 10000,
      },
      campaignsPerDay: {
        type: Number,
        default: 50,
      },
      currentDayUsage: {
        messages: {
          type: Number,
          default: 0,
        },
        campaigns: {
          type: Number,
          default: 0,
        },
        lastReset: {
          type: Date,
          default: Date.now,
        },
      },
    },

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

userSchema.methods.updateStats = async function (campaignData) {
  this.stats.totalCampaigns += 1;
  this.stats.totalMessagesSent += campaignData.messagesSent || 0;
  this.stats.totalSpent += campaignData.cost || 0;
  this.stats.lastCampaignAt = new Date();
  
  // Calculate success rate
  if (this.stats.totalMessagesSent > 0) {
    this.stats.successRate = ((this.stats.totalMessagesSent - campaignData.failedMessages || 0) / this.stats.totalMessagesSent) * 100;
  }
  
  await this.save();
};

userSchema.methods.checkRateLimit = function (type = 'messages') {
  const now = new Date();
  const lastReset = this.rateLimits.currentDayUsage.lastReset;
  
  // Reset daily usage if it's a new day
  if (!lastReset || now.toDateString() !== lastReset.toDateString()) {
    this.rateLimits.currentDayUsage.messages = 0;
    this.rateLimits.currentDayUsage.campaigns = 0;
    this.rateLimits.currentDayUsage.lastReset = now;
  }
  
  if (type === 'messages') {
    return this.rateLimits.currentDayUsage.messages < this.rateLimits.messagesPerDay;
  } else if (type === 'campaigns') {
    return this.rateLimits.currentDayUsage.campaigns < this.rateLimits.campaignsPerDay;
  }
  
  return false;
};

userSchema.methods.incrementUsage = async function (type = 'messages', count = 1) {
  if (type === 'messages') {
    this.rateLimits.currentDayUsage.messages += count;
  } else if (type === 'campaigns') {
    this.rateLimits.currentDayUsage.campaigns += count;
  }
  
  await this.save();
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