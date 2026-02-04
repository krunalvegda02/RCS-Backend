import User, { ONBOARDING_STATUS } from '../models/user.model.js';
import {
    sendOnboardingSubmittedEmail,
    sendAdminNewApplicationEmail,
    sendAccountApprovedEmail,
    sendAccountRejectedEmail,
} from '../services/email.service.js';

/**
 * Get current user's onboarding status
 * GET /api/v1/onboarding/status
 */
export const getOnboardingStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('name email onboardingStatus onboardingData reviewDetails jioConfig.isConfigured')
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        res.json({
            success: true,
            data: {
                onboardingStatus: user.onboardingStatus,
                onboardingData: user.onboardingData || {},
                reviewDetails: user.reviewDetails || {},
                isJioConfigured: user.jioConfig?.isConfigured || false,
            },
        });
    } catch (error) {
        console.error('Get onboarding status error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

/**
 * Submit onboarding data
 * POST /api/v1/onboarding/submit
 */
export const submitOnboarding = async (req, res) => {
    try {
        const userId = req.user._id;

        const {
            companyName,
            brandName,
            businessEmail,
            businessPhone,
            industry,
            companyAddress,
            website,
            gstNumber,
            registrationCertificateUrl,
            brandLogoUrl,
            companyBannerUrl,
        } = req.body;

        // Validation
        const requiredFields = {
            companyName: 'Company name',
            brandName: 'Brand name',
            businessEmail: 'Business email',
            businessPhone: 'Business phone',
            industry: 'Industry',
            companyAddress: 'Company address',
            gstNumber: 'GST number',
        };

        const missingFields = Object.entries(requiredFields)
            .filter(([key]) => !req.body[key])
            .map(([_, label]) => label);

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}`,
            });
        }

        // Validate GST number format
        const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        if (!gstRegex.test(gstNumber.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid GST number format',
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(businessEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid business email format',
            });
        }

        // Check current status
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        if (user.onboardingStatus !== ONBOARDING_STATUS.PENDING_ONBOARDING) {
            return res.status(400).json({
                success: false,
                message: 'Onboarding already submitted or completed',
                onboardingStatus: user.onboardingStatus,
            });
        }

        // Update user with onboarding data
        const onboardingData = {
            companyName: companyName.trim(),
            brandName: brandName.trim(),
            businessEmail: businessEmail.toLowerCase().trim(),
            businessPhone: businessPhone.trim(),
            industry,
            companyAddress: companyAddress.trim(),
            website: website?.trim(),
            gstNumber: gstNumber.toUpperCase().trim(),
            registrationCertificateUrl,
            brandLogoUrl,
            companyBannerUrl,
            submittedAt: new Date(),
        };

        // Also update company name in user profile
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                onboardingData,
                onboardingStatus: ONBOARDING_STATUS.ONBOARDING_SUBMITTED,
                companyname: companyName.trim(),
            },
            { new: true }
        );

        // Send confirmation email to user (non-blocking)
        sendOnboardingSubmittedEmail(user.email, user.name).catch(err => 
            console.error('Email send failed:', err)
        );

        // Notify admin about new application (non-blocking)
        sendAdminNewApplicationEmail(user.name, user.email, companyName).catch(err => 
            console.error('Admin email send failed:', err)
        );

        res.json({
            success: true,
            message: 'Onboarding submitted successfully. Your application is now under review.',
            data: {
                onboardingStatus: updatedUser.onboardingStatus,
                submittedAt: onboardingData.submittedAt,
            },
        });
    } catch (error) {
        console.error('Submit onboarding error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

/**
 * Admin: Get onboarding requests (filter by status)
 * GET /api/v1/onboarding/admin/requests
 */
export const getOnboardingRequests = async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;

        const query = {
            role: 'USER',
            isVerified: false,
        };

        // If status is provided, filter by it
        if (status) {
            query.onboardingStatus = status;
            // If specifically requesting VERIFIED, remove isVerified filter
            if (status === 'VERIFIED') {
                delete query.isVerified;
            }
        }

        const users = await User.find(query)
            .select('name email phone companyname onboardingStatus onboardingData reviewDetails jioConfig createdAt')
            .sort({ 'onboardingData.submittedAt': -1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('reviewDetails.reviewedBy', 'name email')
            .lean();

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
        console.error('Get onboarding requests error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

/**
 * Admin: Approve user onboarding with Jio config
 * POST /api/v1/onboarding/admin/approve/:userId
 */
export const approveOnboarding = async (req, res) => {
    try {
        const { userId } = req.params;
        const { jioConfig, walletBalance = 0, adminNotes } = req.body;

        // Validate Jio config
        if (!jioConfig || !jioConfig.clientId || !jioConfig.clientSecret) {
            return res.status(400).json({
                success: false,
                message: 'Jio Client ID and Client Secret are required for approval',
            });
        }

        // Find user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        if (user.onboardingStatus !== ONBOARDING_STATUS.ONBOARDING_SUBMITTED) {
            return res.status(400).json({
                success: false,
                message: 'User is not in pending approval status',
                onboardingStatus: user.onboardingStatus,
            });
        }

        // Update user with approval
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                onboardingStatus: ONBOARDING_STATUS.VERIFIED,
                isVerified: true,
                isActive: true,
                'jioConfig.clientId': jioConfig.clientId.trim(),
                'jioConfig.clientSecret': jioConfig.clientSecret.trim(),
                'jioConfig.assistantId': jioConfig.assistantId?.trim() || '',
                'jioConfig.isConfigured': true,
                'wallet.balance': walletBalance,
                'reviewDetails.reviewedBy': req.user._id,
                'reviewDetails.reviewedAt': new Date(),
                'reviewDetails.adminNotes': adminNotes?.trim() || '',
            },
            { new: true }
        ).select('name email onboardingStatus');

        // Send approval email (non-blocking)
        sendAccountApprovedEmail(user.email, user.name).catch(err => 
            console.error('Approval email send failed:', err)
        );

        res.json({
            success: true,
            message: 'User approved successfully',
            data: {
                userId: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                onboardingStatus: updatedUser.onboardingStatus,
            },
        });
    } catch (error) {
        console.error('Approve onboarding error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

/**
 * Admin: Reject user onboarding
 * POST /api/v1/onboarding/admin/reject/:userId
 */
export const rejectOnboarding = async (req, res) => {
    try {
        const { userId } = req.params;
        const { rejectionReason, adminNotes } = req.body;

        if (!rejectionReason) {
            return res.status(400).json({
                success: false,
                message: 'Rejection reason is required',
            });
        }

        // Find user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        if (user.onboardingStatus !== ONBOARDING_STATUS.ONBOARDING_SUBMITTED) {
            return res.status(400).json({
                success: false,
                message: 'User is not in pending approval status',
                onboardingStatus: user.onboardingStatus,
            });
        }

        // Update user with rejection
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                onboardingStatus: ONBOARDING_STATUS.REJECTED,
                isActive: false,
                'reviewDetails.reviewedBy': req.user._id,
                'reviewDetails.reviewedAt': new Date(),
                'reviewDetails.rejectionReason': rejectionReason.trim(),
                'reviewDetails.adminNotes': adminNotes?.trim() || '',
            },
            { new: true }
        ).select('name email onboardingStatus');

        // Send rejection email (non-blocking)
        sendAccountRejectedEmail(user.email, user.name, rejectionReason).catch(err => 
            console.error('Rejection email send failed:', err)
        );

        res.json({
            success: true,
            message: 'User rejected',
            data: {
                userId: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                onboardingStatus: updatedUser.onboardingStatus,
            },
        });
    } catch (error) {
        console.error('Reject onboarding error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

/**
 * Admin: Get single user's onboarding details
 * GET /api/v1/onboarding/admin/user/:userId
 */
export const getOnboardingDetails = async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findById(userId)
            .select('name email phone companyname onboardingStatus onboardingData reviewDetails createdAt')
            .populate('reviewDetails.reviewedBy', 'name email')
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        console.error('Get onboarding details error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};
