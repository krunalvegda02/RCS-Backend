import User from '../models/user.model.js';
import jwt from 'jsonwebtoken';

// Generate JWT Tokens
const generateTokens = (userId) => {
  try {
    console.log('Generating tokens for user ID:', userId);
    
    const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    });
    
    const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    });
    
    // Verify the token contains correct user ID
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    console.log('Token contains user ID:', decoded.userId);
    
    return { accessToken, refreshToken };
  } catch (error) {
    console.error('Token generation error:', error);
    throw new Error('Failed to generate authentication tokens');
  }
};

// Login user
export const login = async (req, res) => {
  try {
    const { emailorphone, password } = req.body;

    if (!emailorphone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email/phone and password are required',
      });
    }

    // Find user by email or phone
    const user = await User.findByEmailOrPhone(emailorphone);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      const lockTimeRemaining = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000)); // minutes
      const hours = Math.floor(lockTimeRemaining / 60);
      const minutes = lockTimeRemaining % 60;
      const timeMessage = hours > 0 ? `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}` : `${minutes} minute${minutes !== 1 ? 's' : ''}`;
      
      return res.status(423).json({
        success: false,
        message: `Account is locked due to too many failed login attempts. Please try again after ${timeMessage}.`,
        lockUntil: user.lockUntil,
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator.',
        deactivated: true,
      });
    }

    // Verify password
    console.log('[Login] Comparing password for user:', user.email);
    console.log('[Login] Password from request:', password ? '***' : 'EMPTY');
    console.log('[Login] Encrypted password from DB:', user.password ? 'EXISTS' : 'MISSING');
    
    const isPasswordValid = await user.comparePassword(password);
    console.log('[Login] Password comparison result:', isPasswordValid);

    if (!isPasswordValid) {
      await user.incrementLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Reset login attempts on successful login
    console.log('[Login] Password valid, resetting login attempts');
    await user.resetLoginAttempts();

    // Refresh user document after reset
    const refreshedUser = await User.findById(user._id);

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(refreshedUser._id);

    const userResponse = refreshedUser.toJSON();

    res.json({
      success: true,
      message: 'Login successful',
      user: userResponse,
      access_token: accessToken,
      token: accessToken, // Add this for frontend compatibility
      refresh_token: refreshToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Register user
export const register = async (req, res) => {
  try {
    const { name, email, phone, password, companyname } = req.body;

    // Validation
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, phone, and password are required',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email or phone already exists',
      });
    }

    // Create user
    const userData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      companyname: companyname?.trim(),
      wallet: {
        balance: 0,
        currency: 'INR',
      },
    };

    const user = await User.createUser(userData);

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user,
      access_token: accessToken,
      token: accessToken, // Add this for frontend compatibility
      refresh_token: refreshToken,
    });
  } catch (error) {
    console.error('Registration error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `${field} already exists`,
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get current user profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const userResponse = user.toJSON();
    // Add available balance
    userResponse.wallet.availableBalance = user.getAvailableBalance();

    res.json({
      success: true,
      data: userResponse,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update user profile
export const updateProfile = async (req, res) => {
  try {
    const { name, companyname, phone } = req.body;
    const userId = req.user._id;

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (companyname) updateData.companyname = companyname.trim();
    if (phone) updateData.phone = phone.trim();

    const user = await User.findByIdAndUpdate(
      userId,
      { ...updateData, updatedBy: userId },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user.toJSON(),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `${field} already exists`,
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update user password
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    console.log('Password update request:', { userId, currentPassword: '***', newPassword: '***' });

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    console.log('User found, comparing passwords...');
    
    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    console.log('Password comparison result:', isPasswordValid);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Update password
    user.password = newPassword;
    user.updatedBy = userId;
    await user.save();

    console.log('Password updated successfully');

    res.json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};








// Admin: Create user
export const createUser = async (req, res) => {
  try {
    const { name, email, phone, password, role, companyname, clientId, clientSecret, assistantId, walletBalance } = req.body;

    // Validation
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, phone, and password are required',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email or phone already exists',
      });
    }

    // Create user data
    const userData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      role: role || 'user',
      companyname: companyname?.trim(),
      createdBy: req.user._id,
      wallet: {
        balance: walletBalance || 0,
        currency: 'INR',
      },
    };

    // Add Jio configuration if provided
    if (clientId || clientSecret || assistantId) {
      userData.jioConfig = {
        clientId: clientId?.trim() || '',
        clientSecret: clientSecret?.trim() || '',
        assistantId: assistantId?.trim() || '',
        isConfigured: !!(clientId && clientSecret),
      };
    }

    const user = await User.createUser(userData);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: user,
    });
  } catch (error) {
    console.error('Create user error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `${field} already exists`,
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Update user details
export const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, phone, companyname, isActive, jioConfig } = req.body;

    // Validation
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and phone are required',
      });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if email or phone already exists for other users
    const existingUser = await User.findOne({
      _id: { $ne: userId },
      $or: [{ email: email.toLowerCase() }, { phone }],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email or phone already exists',
      });
    }

    // Update user data
    const updateData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      companyname: companyname?.trim() || '',
      updatedBy: req.user._id,
    };

    // Only update isActive if provided
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    // Update Jio config if provided
    if (jioConfig) {
      updateData['jioConfig.clientId'] = jioConfig.clientId?.trim() || '';
      updateData['jioConfig.clientSecret'] = jioConfig.clientSecret?.trim() || '';
      updateData['jioConfig.assistantId'] = jioConfig.assistantId?.trim() || '';
      updateData['jioConfig.isConfigured'] = !!(jioConfig.clientId && jioConfig.clientSecret);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    console.error('Update user error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `${field} already exists`,
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Get all users (exclude admin role) - lightweight version
export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, role, isActive, search } = req.query;

    const query = { role: { $ne: 'ADMIN' } }; // Exclude admin users
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { companyname: { $regex: search, $options: 'i' } },
      ];
    }

    // Select only essential fields, exclude heavy data like transactions
    const users = await User.find(query)
      .select('name email phone companyname role isActive isVerified wallet.balance wallet.currency createdAt lastLogin')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Get user password
export const getUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const decryptedPassword = user.getDecryptedPassword();

    res.json({
      success: true,
      data: {
        currentPassword: decryptedPassword || 'Old password (bcrypt) - Update password to view',
      },
    });
  } catch (error) {
    console.error('Get user password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Update user password
export const updateUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.password = newPassword;
    user.updatedBy = req.user._id;
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Get user transaction history
export const getUserTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const user = await User.findById(userId).populate('wallet.transactions.processedBy', 'name email');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const transactions = user.wallet.transactions || [];
    // Sort by most recent first
    const sortedTransactions = transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const total = sortedTransactions.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTransactions = sortedTransactions.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        transactions: paginatedTransactions,
        currentBalance: user.wallet.balance,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get transaction history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};












// Refresh token endpoint
export const refreshToken = async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    
    // Find user
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);

    res.json({
      success: true,
      access_token: accessToken,
      token: accessToken, // Add this for frontend compatibility
      refresh_token: newRefreshToken,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token',
    });
  }
};


// Update Jio RCS Configuration
export const updateJioConfig = async (req, res) => {
  try {
    const { clientId, clientSecret, assistantId } = req.body;
    const userId = req.user._id;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        message: 'Client ID and Client Secret are required',
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        'jioConfig.clientId': clientId.trim(),
        'jioConfig.clientSecret': clientSecret.trim(),
        'jioConfig.assistantId': assistantId?.trim() || '',
        'jioConfig.isConfigured': true,
        updatedBy: userId,
      },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      message: 'Jio RCS configuration updated successfully',
      data: {
        clientId: user.jioConfig.clientId,
        assistantId: user.jioConfig.assistantId,
        isConfigured: user.jioConfig.isConfigured,
      },
    });
  } catch (error) {
    console.error('Update Jio config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get Jio RCS Configuration
export const getJioConfig = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      data: {
        clientId: user.jioConfig?.clientId || '',
        assistantId: user.jioConfig?.assistantId || '',
        isConfigured: user.jioConfig?.isConfigured || false,
      },
    });
  } catch (error) {
    console.error('Get Jio config error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};









export const updateWallet = async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, operation = 'add' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const description = `Wallet ${operation === 'add' ? 'credited' : 'debited'} by admin`;
    const newBalance = await user.updateWallet(amount, operation, description, req.user._id);

    res.json({
      success: true,
      message: `Wallet ${operation === 'add' ? 'credited' : 'debited'} successfully`,
      data: {
        userId: user._id,
        newBalance,
        operation,
        amount,
      },
    });
  } catch (error) {
    console.error('Update wallet error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// Cleanup stuck blocked balance for a user
export const cleanupUserBlockedBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const result = await user.cleanupBlockedBalance();

    res.json({
      success: true,
      message: 'Blocked balance cleanup completed',
      data: result,
    });
  } catch (error) {
    console.error('Cleanup blocked balance error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// Cleanup stuck blocked balance for all users
export const cleanupAllBlockedBalances = async (req, res) => {
  try {
    const results = await User.cleanupAllBlockedBalances();

    res.json({
      success: true,
      message: `Cleaned up blocked balances for ${results.length} users`,
      data: results,
    });
  } catch (error) {
    console.error('Cleanup all blocked balances error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// Admin: Toggle user active status
export const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.isActive = !user.isActive;
    user.updatedBy = req.user._id;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { isActive: user.isActive },
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Admin: Unlock user account
export const unlockUserAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await user.resetLoginAttempts();

    res.json({
      success: true,
      message: 'User account unlocked successfully',
    });
  } catch (error) {
    console.error('Unlock user account error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};