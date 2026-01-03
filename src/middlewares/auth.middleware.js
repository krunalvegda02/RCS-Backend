import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';

// Authenticate JWT token
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required',
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    // Get user from database
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token - user not found',
      });
    }

    if (!user.isActive) {
      // Clear any existing tokens
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated',
        deactivated: true,
      });
    }

    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Require admin role
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
  }
  next();
};

// Require user role (user or admin)
export const requireUser = (req, res, next) => {
  if (!['USER', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'User access required',
    });
  }
  next();
};

// Check rate limits
// export const checkRateLimit = (type = 'messages') => {
//   return (req, res, next) => {
//     if (!req.user.checkRateLimit(type)) {
//       return res.status(429).json({
//         success: false,
//         message: `Daily ${type} limit exceeded`,
//       });
//     }
//     next();
//   };
// };

// Check wallet balance
export const checkWalletBalance = (minimumAmount = 0) => {
  return (req, res, next) => {
    if (req.user.wallet.balance < minimumAmount) {
      return res.status(402).json({
        success: false,
        message: 'Insufficient wallet balance',
        required: minimumAmount,
        available: req.user.wallet.balance,
      });
    }
    next();
  };
};