
/**
 * Welcome email template
 */
export const welcomeEmailTemplate = (name, tenantName) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">Welcome to ${tenantName || 'Chat App'}! 🎉</h1>
            </div>
            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 16px;">Hi ${name},</p>
                
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Thank you for joining ${tenantName || 'Chat App'}! We're excited to have you on board.
                </p>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    You can now:
                </p>

                <ul style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.8;">
                    <li>📱 Connect with your contacts</li>
                    <li>💬 Send and receive messages</li>
                    <li>👥 Create group chats</li>
                    <li>🔔 Get notifications for new messages</li>
                </ul>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Start by logging in and adding your first contact!
                </p>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL || 'https://example.com'}/login" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Open Chat App
                    </a>
                </div>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
                    Questions? Contact our support team at support@chatapp.com
                </p>
            </div>
        </div>
    `;
};

/**
 * Invite email template
 */
export const inviteEmailTemplate = (tenantName, inviteUrl) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">You're Invited! 🎉</h1>
            </div>
            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 16px;">Hi there,</p>
                
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    You've been invited to join <strong>${tenantName}</strong> on Chat App!
                </p>

                <p style="margin: 0 0 30px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Click the button below to accept the invitation and create your account.
                </p>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${inviteUrl}" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Accept Invitation
                    </a>
                </div>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 12px; line-height: 1.6;">
                    Or copy this link in your browser:
                </p>
                <p style="margin: 0 0 30px 0; color: #667eea; font-size: 12px; word-break: break-all;">
                    ${inviteUrl}
                </p>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 12px; line-height: 1.6;">
                    This invitation will expire in 7 days.
                </p>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
                    If you didn't expect this invitation, you can safely ignore this email.
                </p>
            </div>
        </div>
    `;
};

/**
 * Password reset email template
 */
export const passwordResetEmailTemplate = (name, resetToken, resetUrl) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">Password Reset Request 🔐</h1>
            </div>
            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 16px;">Hi ${name},</p>
                
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    We received a request to reset your password. Click the button below to create a new password.
                </p>

                <p style="margin: 0 0 10px 0; color: #d32f2f; font-size: 13px; line-height: 1.6;">
                    ⚠️ This link expires in 30 minutes
                </p>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetUrl}" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Reset Password
                    </a>
                </div>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 12px; line-height: 1.6;">
                    Or copy this link:
                </p>
                <p style="margin: 0 0 30px 0; color: #667eea; font-size: 12px; word-break: break-all; background: #f5f5f5; padding: 10px; border-radius: 5px;">
                    ${resetUrl}
                </p>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 12px; line-height: 1.6;">
                    <strong>Reset Code (if needed):</strong> ${resetToken}
                </p>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="margin: 0 0 10px 0; color: #666; font-size: 12px; line-height: 1.6;">
                    If you didn't request a password reset, please ignore this email or change your password if you suspect unauthorized access.
                </p>

                <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
                    For security, never share this link with anyone.
                </p>
            </div>
        </div>
    `;
};

/**
 * Phone verification email template
 */
export const phoneVerificationEmailTemplate = (name, verificationCode) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">Phone Verification 📱</h1>
            </div>
            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 16px;">Hi ${name},</p>
                
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Here's your phone verification code:
                </p>

                <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; border-left: 4px solid #667eea;">
                    <p style="margin: 0; font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 5px;">
                        ${verificationCode}
                    </p>
                    <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">
                        Valid for 10 minutes
                    </p>
                </div>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Enter this code in the app to verify your phone number.
                </p>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="margin: 0 0 10px 0; color: #666; font-size: 12px; line-height: 1.6;">
                    If you didn't request this code, please ignore this email.
                </p>

                <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
                    Never share this code with anyone.
                </p>
            </div>
        </div>
    `;
};

/**
 * Account created email template
 */
export const accountCreatedEmailTemplate = (name) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">Account Created ✅</h1>
            </div>
            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 16px;">Welcome, ${name}! 👋</p>
                
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Your account has been created successfully. You can now log in and start connecting with your contacts.
                </p>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL || 'https://example.com'}/login" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Go to Login
                    </a>
                </div>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
                    Questions? Contact our support team at support@chatapp.com
                </p>
            </div>
        </div>
    `;
};

/**
 * OTP email template
 */
export const otpEmailTemplate = (name, otp) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
            <div style="background: linear-gradient(135deg, #008069 0%, #00a884 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">Password Reset OTP 🔐</h1>
            </div>
            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 16px;">Hi ${name || 'there'},</p>
                
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Your password reset OTP is:
                </p>

                <div style="text-align: center; margin: 30px 0; padding: 25px; background: linear-gradient(135deg, #f0f2f5 0%, #e9edef 100%); border-radius: 10px; border: 2px dashed #008069;">
                    <p style="margin: 0; font-size: 42px; font-weight: bold; color: #008069; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                        ${otp}
                    </p>
                    <p style="margin: 15px 0 0 0; color: #d32f2f; font-size: 13px; font-weight: 600;">
                        ⏱️ Expires in 10 minutes
                    </p>
                </div>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Enter this code on the password reset page to continue.
                </p>

                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 5px; margin: 20px 0;">
                    <p style="margin: 0; color: #856404; font-size: 13px;">
                        ⚠️ <strong>Security Notice:</strong> Never share this code with anyone. Our team will never ask for your OTP.
                    </p>
                </div>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="margin: 0 0 10px 0; color: #666; font-size: 12px; line-height: 1.6;">
                    If you didn't request this password reset, please ignore this email and ensure your account is secure.
                </p>

                <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
                    This is an automated message, please do not reply.
                </p>
            </div>
        </div>
    `;
};

/**
 * Password changed successfully email template
 */
export const passwordChangedEmailTemplate = (name) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
            <div style="background: linear-gradient(135deg, #008069 0%, #00a884 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">Password Changed ✅</h1>
            </div>
            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 16px;">Hi ${name || 'there'},</p>
                
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Your password has been changed successfully. You can now log in with your new password.
                </p>

                <div style="text-align: center; margin: 30px 0; padding: 20px; background: #e8f5e9; border-radius: 10px; border-left: 4px solid #4caf50;">
                    <p style="margin: 0; font-size: 48px; color: #4caf50;">✓</p>
                    <p style="margin: 10px 0 0 0; color: #2e7d32; font-size: 16px; font-weight: 600;">
                        Password Updated Successfully
                    </p>
                </div>

                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 5px; margin: 20px 0;">
                    <p style="margin: 0; color: #856404; font-size: 13px;">
                        ⚠️ <strong>Security Alert:</strong> If you didn't make this change, please contact support immediately.
                    </p>
                </div>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL || 'https://example.com'}/login" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #008069 0%, #00a884 100%); color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Go to Login
                    </a>
                </div>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                
                <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
                    For security, we recommend using a strong, unique password.
                </p>
            </div>
        </div>
    `;
};

/**
 * Login alert email template
 */
export const loginAlertEmailTemplate = (name, deviceInfo, timestamp) => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 20px;">
            <div style="background: linear-gradient(135deg, #d32f2f 0%, #ff6f00 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 24px;">Login Alert 🔔</h1>
            </div>
            <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px;">
                <p style="margin: 0 0 20px 0; color: #333; font-size: 16px;">Hi ${name},</p>
                
                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    Your account was accessed at ${timestamp}
                </p>

                <div style="margin: 0 0 20px 0; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 5px;">
                    <p style="margin: 0; color: #856404; font-size: 14px;">
                        <strong>Device:</strong> ${deviceInfo || 'Unknown device'}
                    </p>
                </div>

                <p style="margin: 0 0 20px 0; color: #666; font-size: 14px; line-height: 1.6;">
                    If this was you, you can dismiss this alert. If this wasn't you, please change your password immediately.
                </p>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL || 'https://example.com'}/change-password" style="display: inline-block; padding: 12px 30px; background: #d32f2f; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Change Password
                    </a>
                </div>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
                <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
                    For your security, we recommend changing your password if you don't recognize this login.
                </p>
            </div>
        </div>
    `;
};