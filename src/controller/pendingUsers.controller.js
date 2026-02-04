import User from '../models/user.model.js';

// Get all pending users (users who registered but not approved)
export const getPendingUsers = async (req, res) => {
  try {
    const pendingUsers = await User.find({ 
      isVerified: false,
      role: 'USER'
    })
    .select('name email phone companyname createdAt')
    .sort({ createdAt: -1 })
    .lean();

    res.json({
      success: true,
      data: pendingUsers
    });
  } catch (error) {
    console.error('Get pending users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Approve pending user
export const approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { walletBalance = 0 } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { 
        isVerified: true,
        isActive: true,
        onboardingStatus: 'VERIFIED',
        'wallet.balance': walletBalance
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User approved successfully',
      data: user
    });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Reject pending user
export const rejectUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByIdAndDelete(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User rejected and deleted successfully'
    });
  } catch (error) {
    console.error('Reject user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
