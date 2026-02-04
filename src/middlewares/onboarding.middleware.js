import { ONBOARDING_STATUS } from '../models/user.model.js';

/**
 * Middleware to ensure user has completed onboarding and is verified
 * Use this on routes that require full platform access
 */
export const requireOnboarded = (req, res, next) => {
    const user = req.user;

    if (!user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
        });
    }

    if (user.onboardingStatus !== ONBOARDING_STATUS.VERIFIED) {
        const statusMessages = {
            [ONBOARDING_STATUS.PENDING_ONBOARDING]: 'Please complete your onboarding to access this feature',
            [ONBOARDING_STATUS.ONBOARDING_SUBMITTED]: 'Your application is pending admin approval',
            [ONBOARDING_STATUS.REJECTED]: 'Your application was not approved',
        };

        const redirectPaths = {
            [ONBOARDING_STATUS.PENDING_ONBOARDING]: '/onboarding',
            [ONBOARDING_STATUS.ONBOARDING_SUBMITTED]: '/pending-approval',
            [ONBOARDING_STATUS.REJECTED]: '/login?reason=rejected',
        };

        return res.status(403).json({
            success: false,
            message: statusMessages[user.onboardingStatus] || 'Onboarding not complete',
            onboardingStatus: user.onboardingStatus,
            redirectTo: redirectPaths[user.onboardingStatus] || '/onboarding',
        });
    }

    next();
};

/**
 * Middleware to check if user can access onboarding flow
 * Only users with PENDING_ONBOARDING status can submit onboarding
 */
export const requirePendingOnboarding = (req, res, next) => {
    const user = req.user;

    if (!user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
        });
    }

    if (user.onboardingStatus !== ONBOARDING_STATUS.PENDING_ONBOARDING) {
        const statusMessages = {
            [ONBOARDING_STATUS.ONBOARDING_SUBMITTED]: 'You have already submitted your onboarding application',
            [ONBOARDING_STATUS.VERIFIED]: 'Your account is already verified',
            [ONBOARDING_STATUS.REJECTED]: 'Your application was not approved',
        };

        return res.status(400).json({
            success: false,
            message: statusMessages[user.onboardingStatus] || 'Cannot access onboarding at this stage',
            onboardingStatus: user.onboardingStatus,
        });
    }

    next();
};

/**
 * Middleware to allow access based on specific onboarding statuses
 * @param {Array} allowedStatuses - Array of allowed onboarding statuses
 */
export const requireOnboardingStatus = (allowedStatuses) => {
    return (req, res, next) => {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
        }

        if (!allowedStatuses.includes(user.onboardingStatus)) {
            return res.status(403).json({
                success: false,
                message: 'Access not allowed at this stage',
                onboardingStatus: user.onboardingStatus,
                allowedStatuses,
            });
        }

        next();
    };
};

export default {
    requireOnboarded,
    requirePendingOnboarding,
    requireOnboardingStatus,
};
