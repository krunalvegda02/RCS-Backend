import WalletRequest from '../models/walletRequest.model.js';
import User from '../models/user.model.js';

// Get all wallet requests (Admin only)
export const getAllWalletRequests = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, userId } = req.query;

    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;

    const requests = await WalletRequest.find(query)
      .populate('userId', 'name email phone')
      .populate('processedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await WalletRequest.countDocuments(query);

    res.json({
      success: true,
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get wallet requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Approve wallet request (Admin only)
export const approveWalletRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { adminNote } = req.body;

    const request = await WalletRequest.findById(requestId).populate('userId');
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Wallet request not found',
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Request has already been processed',
      });
    }

    // Update user wallet
    const user = await User.findById(request.userId._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await user.updateWallet(request.amount, 'add', `Wallet request approved - Request ID: ${request._id}`, req.user._id);

    // Update request status
    request.status = 'approved';
    request.processedAt = new Date();
    request.processedBy = req.user._id;
    request.adminNote = adminNote || 'Approved by admin';
    await request.save();

    res.json({
      success: true,
      message: 'Wallet request approved successfully',
      data: {
        requestId: request._id,
        amount: request.amount,
        newBalance: user.wallet.balance,
      },
    });
  } catch (error) {
    console.error('Approve wallet request error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// Reject wallet request (Admin only)
export const rejectWalletRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { rejectionReason, adminNote } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required',
      });
    }

    const request = await WalletRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Wallet request not found',
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Request has already been processed',
      });
    }

    // Update request status
    request.status = 'rejected';
    request.processedAt = new Date();
    request.processedBy = req.user._id;
    request.rejectionReason = rejectionReason;
    request.adminNote = adminNote || 'Rejected by admin';
    await request.save();

    // Add transaction record for audit (no balance change)
    const user = await User.findById(request.userId);
    if (user) {
      await user.addTransactionRecord(
        'debit',
        0,
        `Wallet request rejected - Amount: ₹${request.amount} - Reason: ${rejectionReason}`,
        req.user._id
      );
    }

    res.json({
      success: true,
      message: 'Wallet request rejected successfully',
    });
  } catch (error) {
    console.error('Reject wallet request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete wallet request (Admin only)
export const deleteWalletRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await WalletRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Wallet request not found',
      });
    }

    await WalletRequest.findByIdAndDelete(requestId);

    res.json({
      success: true,
      message: 'Wallet request deleted successfully',
    });
  } catch (error) {
    console.error('Delete wallet request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create wallet request (User)
export const createWalletRequest = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user._id;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
      });
    }

    // Check if user has pending request
    const existingRequest = await WalletRequest.findOne({
      userId,
      status: 'pending',
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending wallet request',
      });
    }

    const request = new WalletRequest({
      userId,
      amount,
    });

    await request.save();

    res.status(201).json({
      success: true,
      message: 'Wallet request created successfully',
      data: request,
    });
  } catch (error) {
    console.error('Create wallet request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get user's wallet requests
export const getUserWalletRequests = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const requests = await WalletRequest.find({ userId })
      .populate('processedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await WalletRequest.countDocuments({ userId });

    res.json({
      success: true,
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get user wallet requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};