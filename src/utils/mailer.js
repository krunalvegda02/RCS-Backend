import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { welcomeEmailTemplate, inviteEmailTemplate, passwordResetEmailTemplate, accountCreatedEmailTemplate, otpEmailTemplate, passwordChangedEmailTemplate } from './emailTemplates.js';
dotenv.config();

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

export const sendWelcomeEmail = async (email, name, tenantName) => {
    try {
        await transporter.sendMail({
            from: `"${tenantName || 'Chat App'}" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Welcome to ${tenantName || 'Chat App'}! 🎉`,
            html: welcomeEmailTemplate(name, tenantName)
        });
        console.log(`✅ Welcome email sent to ${email}`);
    } catch (error) {
        console.error('❌ Failed to send welcome email:', error.message);
    }
};

export const sendInviteEmail = async (email, tenantName, inviteUrl) => {
    try {
        await transporter.sendMail({
            from: `"${tenantName}" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `You're invited to join ${tenantName}! 🎉`,
            html: inviteEmailTemplate(tenantName, inviteUrl)
        });
        console.log(`✅ Invite email sent to ${email}`);
    } catch (error) {
        console.error('❌ Failed to send invite email:', error.message);
    }
};

export const sendPasswordResetEmail = async (email, name, resetToken, resetUrl) => {
    try {
        await transporter.sendMail({
            from: `"Chat App" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Password Reset Request 🔐`,
            html: passwordResetEmailTemplate(name, resetToken, resetUrl)
        });
        console.log(`✅ Password reset email sent to ${email}`);
    } catch (error) {
        console.error('❌ Failed to send password reset email:', error.message);
    }
};

export const sendOTPEmail = async (email, name, otp) => {
    try {
        await transporter.sendMail({
            from: `"Chat App" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Your Password Reset OTP - ${otp}`,
            html: otpEmailTemplate(name, otp)
        });
        console.log(`✅ OTP email sent to ${email}`);
    } catch (error) {
        console.error('❌ Failed to send OTP email:', error.message);
        throw error;
    }
};

export const sendPasswordChangedEmail = async (email, name) => {
    try {
        await transporter.sendMail({
            from: `"Chat App" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Password Changed Successfully ✅',
            html: passwordChangedEmailTemplate(name)
        });
        console.log(`✅ Password changed email sent to ${email}`);
    } catch (error) {
        console.error('❌ Failed to send password changed email:', error.message);
    }
};


export const sendPhoneVerificationEmail = async (email, name, verificationCode) => {
    try {
        await transporter.sendMail({
            from: `"Chat App" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Phone Verification Code 📱`,
            html: phoneVerificationEmailTemplate(name, verificationCode)
        });
        console.log(`✅ Phone verification email sent to ${email}`);
    } catch (error) {
        console.error('❌ Failed to send phone verification email:', error.message);
    }
};

/**
 * Send phone verification SMS (logs to console)
 */
export const sendPhoneVerificationSMS = async (phone, verificationCode) => {
    try {
        console.log('\n' + '='.repeat(70));
        console.log('📱 SMS VERIFICATION CODE');
        console.log('='.repeat(70));
        console.log(`To: ${phone}`);
        console.log(`Code: ${verificationCode}`);
        console.log(`Message: Your verification code is: ${verificationCode}. Valid for 10 minutes.`);
        console.log('='.repeat(70) + '\n');
    } catch (error) {
        console.error('❌ Failed to send phone verification SMS:', error.message);
    }
};

/**
 * Send password reset SMS (logs to console)
 */
export const sendPasswordResetSMS = async (phone, resetCode) => {
    try {
        console.log('\n' + '='.repeat(70));
        console.log('📱 SMS PASSWORD RESET CODE');
        console.log('='.repeat(70));
        console.log(`To: ${phone}`);
        console.log(`Code: ${resetCode}`);
        console.log(`Message: Your password reset code is: ${resetCode}. Valid for 30 minutes.`);
        console.log('='.repeat(70) + '\n');
    } catch (error) {
        console.error('❌ Failed to send password reset SMS:', error.message);
    }
};

/**
 * Send login alert SMS (logs to console)
 */
export const sendLoginAlertSMS = async (phone, deviceInfo) => {
    try {
        console.log('\n' + '='.repeat(70));
        console.log('📱 SMS LOGIN ALERT');
        console.log('='.repeat(70));
        console.log(`To: ${phone}`);
        console.log(`Message: Login alert: Your account was accessed from ${deviceInfo || 'a new device'}.`);
        console.log('='.repeat(70) + '\n');
    } catch (error) {
        console.error('❌ Failed to send login alert SMS:', error.message);
    }
};

/**
 * Send contact request SMS (logs to console)
 */
export const sendContactRequestSMS = async (phone, contactName) => {
    try {
        console.log('\n' + '='.repeat(70));
        console.log('📱 SMS CONTACT NOTIFICATION');
        console.log('='.repeat(70));
        console.log(`To: ${phone}`);
        console.log(`Message: ${contactName || 'Someone'} added you as a contact in Chat App.`);
        console.log('='.repeat(70) + '\n');
    } catch (error) {
        console.error('❌ Failed to send contact request SMS:', error.message);
    }
};

export { transporter };