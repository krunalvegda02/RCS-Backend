// import nodemailer from 'nodemailer';

// // Email configuration - Using nodemailer with Gmail
// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS,
//     },
// });

// const FROM_EMAIL = process.env.EMAIL_USER || 'noreply@rcssender.com';
// const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.EMAIL_USER;

// // Email Templates
// const LOGO_URL = 'https://res.cloudinary.com/krunalvegda02/image/upload/v1770204130/RCSLogo_1_z0vlws.png';
// const PRIMARY_COLOR = '#1a56db';
// const SUCCESS_COLOR = '#0e9f6e';
// const WARNING_COLOR = '#f59e0b';
// const TEXT_COLOR = '#111827';
// const BG_COLOR = '#f9fafb';

// const templates = {
//     onboardingSubmitted: (name) => ({
//         subject: '✅ Your RCS Platform Application is Under Review',
//         html: `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <style>
//           * { margin: 0; padding: 0; box-sizing: border-box; }
//           body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: ${TEXT_COLOR}; background: ${BG_COLOR}; }
//           .email-wrapper { background: ${BG_COLOR}; padding: 40px 20px; }
//           .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07); }
//           .header { background: linear-gradient(135deg, ${PRIMARY_COLOR} 0%, #1e40af 100%); padding: 48px 40px; text-align: center; }
//           .logo { width: 200px; height: auto; margin-bottom: 24px; background: white; padding: 16px; border-radius: 12px; }
//           .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 700; }
//           .content { padding: 48px 40px; background: white; }
//           .greeting { font-size: 18px; color: ${TEXT_COLOR}; margin-bottom: 24px; font-weight: 600; }
//           .message { font-size: 16px; color: #4b5563; line-height: 1.8; margin-bottom: 24px; }
//           .highlight { background: linear-gradient(135deg, ${PRIMARY_COLOR}08 0%, ${PRIMARY_COLOR}15 100%); padding: 24px; border-radius: 12px; border-left: 4px solid ${PRIMARY_COLOR}; margin: 32px 0; }
//           .highlight strong { color: ${PRIMARY_COLOR}; font-size: 18px; display: block; margin-bottom: 16px; }
//           .highlight ul { margin: 12px 0 0 24px; color: #4b5563; }
//           .highlight ul li { margin: 12px 0; }
//           .footer { background: #1f2937; padding: 32px 40px; text-align: center; color: #9ca3af; font-size: 14px; }
//           @media only screen and (max-width: 600px) {
//             .email-wrapper { padding: 20px 10px; }
//             .content, .header { padding: 32px 24px; }
//             .logo { width: 160px; }
//           }
//         </style>
//       </head>
//       <body>
//         <div class="email-wrapper">
//           <div class="email-container">
//             <div class="header">
//               <img src="${LOGO_URL}" alt="RCS Platform" class="logo" />
//               <h1>🚀 Application Received!</h1>
//             </div>
//             <div class="content">
//               <div class="greeting">Hi ${name},</div>
//               <div class="message">
//                 Thank you for completing your onboarding application for the RCS Platform. We're excited to have you on board!
//               </div>
              
//               <div class="highlight">
//                 <strong>📋 What happens next?</strong>
//                 <ul>
//                   <li>Our team will review your application and documents</li>
//                   <li>This typically takes 24-48 business hours</li>
//                   <li>You'll receive an email once your account is activated</li>
//                 </ul>
//               </div>
              
//               <div class="message">
//                 If you have any questions in the meantime, feel free to reach out to our support team.
//               </div>
              
//               <div class="message" style="margin-top: 32px;">
//                 Best regards,<br>
//                 <strong>The RCS Platform Team</strong>
//               </div>
//             </div>
//             <div class="footer">
//               © ${new Date().getFullYear()} RCS Platform. All rights reserved.
//             </div>
//           </div>
//         </div>
//       </body>
//       </html>
//     `,
//     }),

//     adminNewApplication: (userName, userEmail, companyName) => ({
//         subject: `📝 New Onboarding Application: ${userName}`,
//         html: `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <style>
//           * { margin: 0; padding: 0; box-sizing: border-box; }
//           body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: ${TEXT_COLOR}; background: ${BG_COLOR}; }
//           .email-wrapper { background: ${BG_COLOR}; padding: 40px 20px; }
//           .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07); }
//           .header { background: linear-gradient(135deg, #1f2937 0%, #111827 100%); padding: 40px; text-align: center; }
//           .logo { width: 180px; height: auto; margin-bottom: 20px; background: white; padding: 12px; border-radius: 10px; }
//           .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 700; }
//           .content { padding: 40px; background: white; }
//           .info-box { background: ${BG_COLOR}; padding: 24px; border-radius: 12px; margin: 24px 0; border: 2px solid #e5e7eb; }
//           .info-box p { margin: 12px 0; font-size: 15px; }
//           .info-box strong { color: ${TEXT_COLOR}; font-weight: 600; }
//           .footer { background: #1f2937; padding: 24px; text-align: center; color: #9ca3af; font-size: 13px; }
//         </style>
//       </head>
//       <body>
//         <div class="email-wrapper">
//           <div class="email-container">
//             <div class="header">
//               <img src="${LOGO_URL}" alt="RCS Platform" class="logo" />
//               <h1>🔔 New User Application</h1>
//             </div>
//             <div class="content">
//               <p style="font-size: 16px; margin-bottom: 24px;">A new user has submitted their onboarding application:</p>
              
//               <div class="info-box">
//                 <p><strong>Name:</strong> ${userName}</p>
//                 <p><strong>Email:</strong> ${userEmail}</p>
//                 <p><strong>Company:</strong> ${companyName || 'Not specified'}</p>
//                 <p><strong>Submitted:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
//               </div>
              
//               <p style="font-size: 15px; color: #4b5563;">Please review their application in the admin panel.</p>
//             </div>
//             <div class="footer">
//               © ${new Date().getFullYear()} RCS Platform Admin
//             </div>
//           </div>
//         </div>
//       </body>
//       </html>
//     `,
//     }),

//     accountApproved: (name) => ({
//         subject: '🎉 Your RCS Platform Account is Now Active!',
//         html: `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <style>
//           * { margin: 0; padding: 0; box-sizing: border-box; }
//           body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: ${TEXT_COLOR}; background: ${BG_COLOR}; }
//           .email-wrapper { background: ${BG_COLOR}; padding: 40px 20px; }
//           .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07); }
//           .header { background: linear-gradient(135deg, ${SUCCESS_COLOR} 0%, #047857 100%); padding: 48px 40px; text-align: center; }
//           .logo { width: 200px; height: auto; margin-bottom: 24px; background: white; padding: 16px; border-radius: 12px; }
//           .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 700; }
//           .content { padding: 48px 40px; background: white; }
//           .success-box { background: linear-gradient(135deg, ${SUCCESS_COLOR}08 0%, ${SUCCESS_COLOR}15 100%); padding: 28px; border-radius: 12px; border-left: 4px solid ${SUCCESS_COLOR}; margin: 32px 0; text-align: center; }
//           .success-box strong { color: ${SUCCESS_COLOR}; font-size: 20px; display: block; margin-bottom: 12px; }
//           .button { display: inline-block; background: linear-gradient(135deg, ${SUCCESS_COLOR} 0%, #047857 100%); color: white; padding: 16px 48px; text-decoration: none; border-radius: 10px; margin-top: 24px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 12px ${SUCCESS_COLOR}40; }
//           .footer { background: #1f2937; padding: 32px; text-align: center; color: #9ca3af; font-size: 14px; }
//         </style>
//       </head>
//       <body>
//         <div class="email-wrapper">
//           <div class="email-container">
//             <div class="header">
//               <img src="${LOGO_URL}" alt="RCS Platform" class="logo" />
//               <h1>🎉 Welcome to RCS Platform!</h1>
//             </div>
//             <div class="content">
//               <p style="font-size: 18px; font-weight: 600; margin-bottom: 24px;">Hi ${name},</p>
              
//               <div class="success-box">
//                 <strong>✅ Great news!</strong>
//                 <p style="margin: 0; font-size: 16px; color: #4b5563;">Your account has been verified and activated. You now have full access to the RCS Platform!</p>
//               </div>
              
//               <center>
//                 <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" class="button">
//                   Login to Dashboard →
//                 </a>
//               </center>
              
//               <p style="margin-top: 32px; font-size: 15px; color: #4b5563;">If you have any questions, our support team is here to help!</p>
              
//               <p style="margin-top: 24px; font-size: 15px;">
//                 Best regards,<br>
//                 <strong>The RCS Platform Team</strong>
//               </p>
//             </div>
//             <div class="footer">
//               © ${new Date().getFullYear()} RCS Platform. All rights reserved.
//             </div>
//           </div>
//         </div>
//       </body>
//       </html>
//     `,
//     }),

//     accountRejected: (name, reason) => ({
//         subject: 'Update on Your RCS Platform Application',
//         html: `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <style>
//           body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
//           .container { max-width: 600px; margin: 0 auto; padding: 20px; }
//           .header { background: #718096; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
//           .header h1 { color: white; margin: 0; font-size: 24px; }
//           .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
//           .reason-box { background: #fff5f5; padding: 20px; border-radius: 8px; border-left: 4px solid #fc8181; margin: 20px 0; }
//           .footer { text-align: center; padding: 20px; color: #888; font-size: 12px; }
//         </style>
//       </head>
//       <body>
//         <div class="container">
//           <div class="header">
//             <h1>Application Update</h1>
//           </div>
//           <div class="content">
//             <p>Hi <strong>${name}</strong>,</p>
            
//             <p>Thank you for your interest in the RCS Platform. After reviewing your application, we were unable to approve it at this time.</p>
            
//             ${reason ? `
//             <div class="reason-box">
//               <strong>📋 Reason:</strong><br>
//               ${reason}
//             </div>
//             ` : ''}
            
//             <p>If you believe this was a mistake or have additional information to provide, please contact our support team and we'll be happy to assist you.</p>
            
//             <p>Best regards,<br>The RCS Platform Team</p>
//           </div>
//           <div class="footer">
//             <p>© ${new Date().getFullYear()} RCS Platform. All rights reserved.</p>
//           </div>
//         </div>
//       </body>
//       </html>
//     `,
//     }),

//     demoScheduled: (name, date, time, company) => ({
//         subject: '✅ Your RCSsender Demo is Confirmed',
//         html: `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <style>
//           * { margin: 0; padding: 0; box-sizing: border-box; }
//           body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1a202c; background: #f7fafc; }
//           .email-wrapper { background: #f7fafc; padding: 40px 20px; }
//           .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07); }
//           .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; }
//           .logo { width: 180px; height: auto; margin-bottom: 20px; }
//           .header h1 { color: #ffffff; font-size: 28px; font-weight: 700; margin: 0; }
//           .header p { color: rgba(255,255,255,0.9); font-size: 16px; margin-top: 8px; }
//           .content { padding: 40px 30px; }
//           .greeting { font-size: 18px; color: #2d3748; margin-bottom: 20px; }
//           .message { font-size: 16px; color: #4a5568; line-height: 1.8; margin-bottom: 30px; }
//           .event-card { background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); border: 2px solid #667eea; border-radius: 12px; padding: 30px; margin: 30px 0; }
//           .event-card h2 { color: #667eea; font-size: 20px; margin-bottom: 20px; display: flex; align-items: center; }
//           .event-card h2::before { content: '📅'; margin-right: 10px; font-size: 24px; }
//           .detail-row { display: flex; padding: 12px 0; border-bottom: 1px solid rgba(102,126,234,0.2); }
//           .detail-row:last-child { border-bottom: none; }
//           .detail-label { font-weight: 600; color: #2d3748; min-width: 120px; }
//           .detail-value { color: #4a5568; flex: 1; }
//           .info-box { background: #edf2f7; border-left: 4px solid #667eea; padding: 20px; border-radius: 8px; margin: 25px 0; }
//           .info-box strong { color: #2d3748; display: block; margin-bottom: 10px; font-size: 16px; }
//           .info-box ul { margin: 10px 0 0 20px; color: #4a5568; }
//           .info-box ul li { margin: 8px 0; }
//           .cta-button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 20px 0; box-shadow: 0 4px 12px rgba(102,126,234,0.3); }
//           .cta-button:hover { box-shadow: 0 6px 16px rgba(102,126,234,0.4); }
//           .divider { height: 1px; background: #e2e8f0; margin: 30px 0; }
//           .footer { background: #2d3748; padding: 30px; text-align: center; color: #a0aec0; }
//           .footer-links { margin: 15px 0; }
//           .footer-links a { color: #667eea; text-decoration: none; margin: 0 15px; }
//           .social-icons { margin: 20px 0; }
//           .social-icons a { display: inline-block; margin: 0 8px; }
//           @media only screen and (max-width: 600px) {
//             .email-wrapper { padding: 20px 10px; }
//             .content { padding: 30px 20px; }
//             .header { padding: 30px 20px; }
//             .event-card { padding: 20px; }
//           }
//         </style>
//       </head>
//       <body>
//         <div class="email-wrapper">
//           <div class="email-container">
//             <div class="header">
//               <img src="${LOGO_URL}" alt="RCSsender" class="logo" />
//               <h1>Demo Confirmed! 🎉</h1>
//               <p>We're excited to show you RCSsender</p>
//             </div>
            
//             <div class="content">
//               <div class="greeting">Hi <strong>${name}</strong>,</div>
              
//               <div class="message">
//                 Thank you for scheduling a demo with RCSsender! Your meeting has been confirmed and we're looking forward to showing you how our platform can transform your business messaging.
//               </div>
              
//               <div class="event-card">
//                 <h2>Meeting Details</h2>
//                 <div class="detail-row">
//                   <div class="detail-label">📅 Date</div>
//                   <div class="detail-value"><strong>${new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
//                 </div>
//                 <div class="detail-row">
//                   <div class="detail-label">🕐 Time</div>
//                   <div class="detail-value"><strong>${time}</strong></div>
//                 </div>
//                 <div class="detail-row">
//                   <div class="detail-label">⏱️ Duration</div>
//                   <div class="detail-value">30 minutes</div>
//                 </div>
//                 <div class="detail-row">
//                   <div class="detail-label">🏢 Company</div>
//                   <div class="detail-value">${company || 'Not specified'}</div>
//                 </div>
//                 <div class="detail-row">
//                   <div class="detail-label">📍 Location</div>
//                   <div class="detail-value">Online Meeting (Link will be shared 15 minutes before)</div>
//                 </div>
//               </div>
              
//               <div class="info-box">
//                 <strong>🔔 Reminders</strong>
//                 You'll receive email reminders:
//                 <ul>
//                   <li>1 day before the meeting</li>
//                   <li>1 hour before the meeting</li>
//                   <li>10 minutes before the meeting</li>
//                 </ul>
//               </div>
              
//               <div class="info-box">
//                 <strong>💡 What to Expect</strong>
//                 <ul>
//                   <li>Personalized platform walkthrough</li>
//                   <li>Live demonstration of RCS messaging features</li>
//                   <li>Discussion of your specific use cases</li>
//                   <li>Q&A session with our product experts</li>
//                   <li>Pricing and implementation guidance</li>
//                 </ul>
//               </div>
              
//               <center>
//                 <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" class="cta-button">Visit RCSsender</a>
//               </center>
              
//               <div class="divider"></div>
              
//               <div class="message" style="font-size: 14px; color: #718096;">
//                 <strong>Need to reschedule?</strong> Please contact us at least 24 hours in advance:<br>
//                 📧 <a href="mailto:info@rcssender.com" style="color: #667eea;">info@rcssender.com</a><br>
//                 📞 <a href="tel:+919462810993" style="color: #667eea;">+91 9462810993</a>
//               </div>
//             </div>
            
//             <div class="footer">
//               <div style="font-size: 14px; margin-bottom: 15px;">Best regards,<br><strong style="color: #fff;">The RCSsender Team</strong></div>
//               <div class="footer-links">
//                 <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}">Website</a> |
//                 <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/support">Support</a> |
//                 <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/docs">Documentation</a>
//               </div>
//               <div style="font-size: 12px; margin-top: 20px; color: #718096;">
//                 © ${new Date().getFullYear()} RCSsender. All rights reserved.<br>
//                 Enterprise RCS Messaging Platform
//               </div>
//             </div>
//           </div>
//         </div>
//       </body>
//       </html>
//     `,
//     }),

//     adminDemoScheduled: (name, email, phone, company, date, time) => ({
//         subject: `🔔 New Demo: ${name} - ${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`,
//         html: `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//         <style>
//           * { margin: 0; padding: 0; box-sizing: border-box; }
//           body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1a202c; background: #f7fafc; }
//           .email-wrapper { background: #f7fafc; padding: 40px 20px; }
//           .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07); }
//           .header { background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%); padding: 30px; text-align: center; }
//           .logo { width: 160px; height: auto; margin-bottom: 15px; }
//           .header h1 { color: #ffffff; font-size: 24px; font-weight: 700; margin: 0; }
//           .badge { display: inline-block; background: #f56565; color: white; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-top: 10px; }
//           .content { padding: 35px 30px; }
//           .alert-box { background: linear-gradient(135deg, #fed7d7 0%, #feb2b2 100%); border-left: 4px solid #f56565; padding: 20px; border-radius: 8px; margin: 25px 0; }
//           .alert-box strong { color: #742a2a; display: block; font-size: 18px; margin-bottom: 10px; }
//           .alert-box .time { color: #742a2a; font-size: 20px; font-weight: 700; margin-top: 5px; }
//           .info-card { background: #f7fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin: 25px 0; }
//           .info-card h3 { color: #2d3748; font-size: 16px; margin-bottom: 15px; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
//           .detail-row { display: flex; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
//           .detail-row:last-child { border-bottom: none; }
//           .detail-label { font-weight: 600; color: #4a5568; min-width: 100px; }
//           .detail-value { color: #2d3748; flex: 1; }
//           .detail-value a { color: #667eea; text-decoration: none; }
//           .quick-actions { background: #edf2f7; padding: 20px; border-radius: 8px; margin: 25px 0; }
//           .quick-actions strong { display: block; margin-bottom: 15px; color: #2d3748; }
//           .action-button { display: inline-block; background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 5px 5px 5px 0; font-size: 14px; font-weight: 600; }
//           .footer { background: #2d3748; padding: 25px; text-align: center; color: #a0aec0; font-size: 12px; }
//           @media only screen and (max-width: 600px) {
//             .email-wrapper { padding: 20px 10px; }
//             .content { padding: 25px 20px; }
//           }
//         </style>
//       </head>
//       <body>
//         <div class="email-wrapper">
//           <div class="email-container">
//             <div class="header">
//               <img src="${LOGO_URL}" alt="RCSsender" class="logo" />
//               <h1>🔔 New Demo Scheduled</h1>
//               <span class="badge">ACTION REQUIRED</span>
//             </div>
            
//             <div class="content">
//               <div class="alert-box">
//                 <strong>📅 Upcoming Demo</strong>
//                 <div class="time">${new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
//                 <div class="time">${time} (30 minutes)</div>
//               </div>
              
//               <div class="info-card">
//                 <h3>👤 Contact Information</h3>
//                 <div class="detail-row">
//                   <div class="detail-label">Name</div>
//                   <div class="detail-value"><strong>${name}</strong></div>
//                 </div>
//                 <div class="detail-row">
//                   <div class="detail-label">Email</div>
//                   <div class="detail-value"><a href="mailto:${email}">${email}</a></div>
//                 </div>
//                 <div class="detail-row">
//                   <div class="detail-label">Phone</div>
//                   <div class="detail-value"><a href="tel:${phone}">${phone}</a></div>
//                 </div>
//                 <div class="detail-row">
//                   <div class="detail-label">Company</div>
//                   <div class="detail-value">${company || 'Not specified'}</div>
//                 </div>
//               </div>
              
//               <div class="quick-actions">
//                 <strong>⚡ Quick Actions</strong>
//                 <a href="mailto:${email}" class="action-button">📧 Send Email</a>
//                 <a href="tel:${phone}" class="action-button">📞 Call</a>
//                 <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/demos" class="action-button">📊 View Dashboard</a>
//               </div>
              
//               <div style="background: #fff5e6; border-left: 4px solid #ed8936; padding: 15px; border-radius: 8px; margin: 20px 0;">
//                 <strong style="color: #7c2d12;">⏰ Reminders Set</strong>
//                 <div style="color: #7c2d12; font-size: 14px; margin-top: 8px;">
//                   You'll receive reminders 1 day, 1 hour, and 10 minutes before the meeting.
//                 </div>
//               </div>
              
//               <div style="font-size: 13px; color: #718096; margin-top: 25px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
//                 <strong>📝 Preparation Checklist:</strong>
//                 <ul style="margin: 10px 0 0 20px;">
//                   <li>Review company background</li>
//                   <li>Prepare demo environment</li>
//                   <li>Send meeting link 15 minutes before</li>
//                   <li>Have pricing information ready</li>
//                 </ul>
//               </div>
              
//               <div style="font-size: 12px; color: #a0aec0; margin-top: 20px;">
//                 Submitted: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' })}
//               </div>
//             </div>
            
//             <div class="footer">
//               © ${new Date().getFullYear()} RCSsender Admin Panel<br>
//               Enterprise RCS Messaging Platform
//             </div>
//           </div>
//         </div>
//       </body>
//       </html>
//     `,
//     }),
// };

// // Send email function
// export const sendEmail = async (to, templateName, templateData = {}) => {
//     try {
//         // Check if email is configured
//         if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
//             console.log(`[Email Service] Email not configured. Would send ${templateName} to ${to}`);
//             return { success: true, simulated: true };
//         }

//         const template = templates[templateName];
//         if (!template) {
//             throw new Error(`Email template '${templateName}' not found`);
//         }

//         const { subject, html } = typeof template === 'function' ? template(...Object.values(templateData)) : template;

//         const info = await transporter.sendMail({
//             from: `RCSsender <${FROM_EMAIL}>`,
//             to,
//             subject,
//             html,
//         });

//         console.log(`[Email Service] Email sent: ${info.messageId}`);
//         return { success: true, messageId: info.messageId };
//     } catch (error) {
//         console.error('[Email Service] Error sending email:', error);
//         return { success: false, error: error.message };
//     }
// };

// // Specific email functions
// export const sendOnboardingSubmittedEmail = async (userEmail, userName) => {
//     return sendEmail(userEmail, 'onboardingSubmitted', { name: userName });
// };

// export const sendAdminNewApplicationEmail = async (userName, userEmail, companyName) => {
//     return sendEmail(ADMIN_EMAIL, 'adminNewApplication', { userName, userEmail, companyName });
// };

// export const sendAccountApprovedEmail = async (userEmail, userName) => {
//     return sendEmail(userEmail, 'accountApproved', { name: userName });
// };

// export const sendAccountRejectedEmail = async (userEmail, userName, reason) => {
//     return sendEmail(userEmail, 'accountRejected', { name: userName, reason });
// };

// export default {
//     sendEmail,
//     sendOnboardingSubmittedEmail,
//     sendAdminNewApplicationEmail,
//     sendAccountApprovedEmail,
//     sendAccountRejectedEmail,
// };














import nodemailer from 'nodemailer';

/* =====================================================
   BRAND CONFIG (MATCHES YOUR LOGO & PRODUCT)
===================================================== */
const BRAND = {
  name: 'RCSsender',
  logo: 'https://res.cloudinary.com/krunalvegda02/image/upload/v1770204130/RCSLogo_1_z0vlws.png',

  colors: {
    primary: '#2563eb',
    primaryDark: '#1e40af',
    gradient: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',

    background: '#f8fafc',
    surface: '#ffffff',

    text: '#0f172a',
    textSecondary: '#475569',

    success: '#16a34a',
    warning: '#f59e0b',
    danger: '#dc2626',
    border: '#e5e7eb',
    footerBg: '#020617'
  },

  font:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
};

/* =====================================================
   EMAIL TRANSPORTER
===================================================== */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const FROM_EMAIL = process.env.EMAIL_USER || 'noreply@rcssender.com';
const ADMIN_EMAIL =
  process.env.ADMIN_NOTIFICATION_EMAIL || process.env.EMAIL_USER;

/* =====================================================
   BASE EMAIL LAYOUT (USED BY ALL TEMPLATES)
===================================================== */
const baseTemplate = ({ title, subtitle, body }) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
body {
  margin: 0;
  padding: 0;
  background: ${BRAND.colors.background};
  font-family: ${BRAND.font};
  color: ${BRAND.colors.text};
}
.wrapper {
  padding: 40px 16px;
}
.container {
  max-width: 620px;
  margin: 0 auto;
  background: ${BRAND.colors.surface};
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid ${BRAND.colors.border};
  box-shadow: 0 20px 40px rgba(0,0,0,0.08);
}
.header {
  background: ${BRAND.colors.gradient};
  padding: 40px 32px;
  text-align: center;
}
.logo {
  width: 180px;
  background: #ffffff;
  padding: 14px;
  border-radius: 12px;
  margin-bottom: 20px;
}
.header h1 {
  margin: 0;
  color: white;
  font-size: 28px;
  font-weight: 800;
}
.header p {
  color: rgba(255,255,255,0.9);
  margin-top: 8px;
  font-size: 15px;
}
.content {
  padding: 40px 32px;
  line-height: 1.7;
}
.footer {
  background: ${BRAND.colors.footerBg};
  padding: 28px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}
.footer strong {
  color: #ffffff;
}
a {
  color: ${BRAND.colors.primary};
  text-decoration: none;
}
@media(max-width:600px) {
  .header, .content {
    padding: 28px 20px;
  }
  .logo {
    width: 150px;
  }
}
</style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <img src="${BRAND.logo}" class="logo" alt="${BRAND.name}" />
        <h1>${title}</h1>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
      <div class="content">
        ${body}
      </div>
      <div class="footer">
        <strong>${BRAND.name}</strong><br/>
        Enterprise RCS Messaging Platform<br/><br/>
        © ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
`;

/* =====================================================
   EMAIL TEMPLATES
===================================================== */
const templates = {
  onboardingSubmitted: (name) => ({
    subject: 'Application Received – RCSsender',
    html: baseTemplate({
      title: 'Application Received',
      subtitle: 'Your onboarding is under review',
      body: `
        <p style="font-size:16px;font-weight:600">Hi ${name},</p>
        <p>
          Thank you for submitting your onboarding application. Our compliance
          team is reviewing your details.
        </p>

        <div style="margin:28px 0;padding:24px;border-left:4px solid ${BRAND.colors.primary};background:#eff6ff;border-radius:12px">
          <strong style="font-size:18px;color:${BRAND.colors.primary}">
            What happens next?
          </strong>
          <ul style="margin-top:12px">
            <li>Business & document verification</li>
            <li>Compliance approval (24–48 hours)</li>
            <li>Account activation email</li>
          </ul>
        </div>

        <p>
          Need help? Contact us at
          <a href="mailto:info@rcssender.com">info@rcssender.com</a>
        </p>

        <p style="margin-top:24px">
          — Team RCSsender
        </p>
      `
    })
  }),

  accountApproved: (name) => ({
    subject: 'Your RCSsender Account is Live 🎉',
    html: baseTemplate({
      title: 'Account Approved',
      subtitle: 'You now have full access',
      body: `
        <p style="font-size:16px;font-weight:600">Hi ${name},</p>

        <div style="margin:32px 0;padding:28px;background:#ecfdf5;border-left:4px solid ${BRAND.colors.success};border-radius:12px;text-align:center">
          <strong style="font-size:20px;color:${BRAND.colors.success}">
            Your account is now active
          </strong>
          <p style="margin-top:12px">
            You can start sending verified RCS messages immediately.
          </p>
        </div>

        <center>
          <a href="${process.env.FRONTEND_URL}/login"
             style="display:inline-block;background:${BRAND.colors.gradient};color:white;padding:16px 44px;border-radius:10px;font-weight:700">
            Login to Dashboard →
          </a>
        </center>
      `
    })
  }),

  accountRejected: (name, reason) => ({
    subject: 'Update on Your RCSsender Application',
    html: baseTemplate({
      title: 'Application Update',
      subtitle: 'Regarding your onboarding request',
      body: `
        <p style="font-size:16px;font-weight:600">Hi ${name},</p>

        <p>
          After careful review, we’re unable to approve your application at
          this time.
        </p>

        ${
          reason
            ? `<div style="margin:24px 0;padding:20px;background:#fef2f2;border-left:4px solid ${BRAND.colors.danger};border-radius:12px">
                <strong>Reason</strong><br/>${reason}
               </div>`
            : ''
        }

        <p>
          You may reapply after updating your information or contact our team
          for clarification.
        </p>
      `
    })
  }),

  demoScheduled: (name, date, time, company, meetingLink) => ({
    subject: 'Your RCSsender Demo is Confirmed',
    html: baseTemplate({
      title: 'Demo Confirmed',
      subtitle: 'We look forward to meeting you',
      body: `
        <p style="font-size:16px;font-weight:600">Hi ${name},</p>

        <div style="margin:32px 0;padding:28px;background:#eff6ff;border-radius:14px;border:2px solid ${BRAND.colors.primary}">
          <strong style="font-size:18px;color:${BRAND.colors.primary}">
            Meeting Details
          </strong>
          <p><strong>Date:</strong> ${date}</p>
          <p><strong>Time:</strong> ${time}</p>
          <p><strong>Duration:</strong> 30 minutes</p>
          <p><strong>Company:</strong> ${company || '—'}</p>
        </div>

        ${meetingLink ? `
        <center>
          <a href="${meetingLink}"
             style="display:inline-block;background:${BRAND.colors.gradient};color:white;padding:16px 44px;border-radius:10px;font-weight:700;text-decoration:none;margin:20px 0">
            Join Meeting →
          </a>
        </center>
        <p style="text-align:center;font-size:12px;color:${BRAND.colors.textTertiary}">
          Meeting Link: <a href="${meetingLink}" style="color:${BRAND.colors.primary}">${meetingLink}</a>
        </p>
        ` : `
        <p style="text-align:center;color:${BRAND.colors.textSecondary}">
          The meeting link will be shared soon.
        </p>
        `}

        <p style="margin-top:24px">
          — Team RCSsender
        </p>
      `
    })
  }),

  adminNewApplication: (userName, userEmail, companyName) => ({
    subject: `New Application: ${userName}`,
    html: baseTemplate({
      title: 'New User Application',
      subtitle: 'Action required',
      body: `
        <p>A new user has submitted their onboarding application:</p>
        <div style="margin:24px 0;padding:24px;background:#f8fafc;border-radius:12px;border:2px solid ${BRAND.colors.border}">
          <p><strong>Name:</strong> ${userName}</p>
          <p><strong>Email:</strong> ${userEmail}</p>
          <p><strong>Company:</strong> ${companyName || 'Not specified'}</p>
          <p><strong>Submitted:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
        </div>
        <p>Please review their application in the admin panel.</p>
      `
    })
  })
};

/* =====================================================
   SEND EMAIL CORE FUNCTION
===================================================== */
export const sendEmail = async (to, templateName, templateData = {}) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log(`[Email] Skipped (${templateName}) → ${to}`);
      return { success: true, skipped: true };
    }

    const template = templates[templateName];
    if (!template) {
      throw new Error(`Template "${templateName}" not found`);
    }

    const { subject, html } = template(...Object.values(templateData));

    const info = await transporter.sendMail({
      from: `${BRAND.name} <${FROM_EMAIL}>`,
      to,
      subject,
      html
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[Email Error]', error);
    return { success: false, error: error.message };
  }
};

/* =====================================================
   HELPER EXPORTS
===================================================== */
export const sendOnboardingSubmittedEmail = (email, name) =>
  sendEmail(email, 'onboardingSubmitted', { name });

export const sendAccountApprovedEmail = (email, name) =>
  sendEmail(email, 'accountApproved', { name });

export const sendAccountRejectedEmail = (email, name, reason) =>
  sendEmail(email, 'accountRejected', { name, reason });

export const sendDemoScheduledEmail = (email, name, date, time, company, meetingLink) =>
  sendEmail(email, 'demoScheduled', { name, date, time, company, meetingLink });

export const sendAdminNewApplicationEmail = (userName, userEmail, companyName) =>
  sendEmail(ADMIN_EMAIL, 'adminNewApplication', { userName, userEmail, companyName });

export default {
  sendEmail,
  sendOnboardingSubmittedEmail,
  sendAdminNewApplicationEmail,
  sendAccountApprovedEmail,
  sendAccountRejectedEmail,
  sendDemoScheduledEmail
};
