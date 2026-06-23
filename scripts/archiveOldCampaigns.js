import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('[ArchiveCron] ❌ MONGODB_URI environment variable is not set');
  process.exit(1);
}

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('[ArchiveCron] ❌ Cloudinary environment variables are not set');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Setup graceful shutdown
setupGracefulShutdown();

async function archiveOldCampaigns() {
  try {
    await connectWithRetry();
    console.log('[ArchiveCron] Connected to MongoDB');

    // Import models
    const User = (await import('../src/models/user.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;
    const ArchivedCampaign = (await import('../src/models/archivedCampaign.model.js')).default;

    // Check if campaign ID is provided as argument. for testing purposes
    const campaignId = process.argv[2];
    let oldCampaigns;

    if (campaignId) {
      console.log(`[ArchiveCron] Archiving specific campaign: ${campaignId}`);
      const campaign = await Campaign.findById(campaignId).lean();

      if (!campaign) {
        console.log('[ArchiveCron] Campaign not found');
        await mongoose.disconnect();
        process.exit(1);
      }

      // Populate user data manually to handle deleted users
      if (campaign.userId) {
        const user = await User.findById(campaign.userId).select('name email').lean();
        campaign.userId = user || { _id: campaign.userId, name: 'Deleted User', email: 'N/A' };
      } else {
        campaign.userId = { name: 'Unknown User', email: 'N/A' };
      }

      oldCampaigns = [campaign];
    } else {
      // Calculate cutoff date (15 days ago)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 15);

      console.log(`[ArchiveCron] Finding campaigns older than ${cutoffDate.toISOString()}`);

      // Find old campaigns
      oldCampaigns = await Campaign.find({
        createdAt: { $lt: cutoffDate },
        status: 'settled'
      }).lean();

      // Populate user data manually to handle deleted users
      for (const campaign of oldCampaigns) {
        if (campaign.userId) {
          const user = await User.findById(campaign.userId).select('name email').lean();
          campaign.userId = user || { name: 'Deleted User', email: 'N/A' };
        } else {
          campaign.userId = { name: 'Unknown User', email: 'N/A' };
        }
      }
    }

    if (oldCampaigns.length === 0) {
      console.log('[ArchiveCron] No old campaigns to archive');
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(`[ArchiveCron] Found ${oldCampaigns.length} campaigns to archive`);

    for (const campaign of oldCampaigns) {
      try {
        console.log(`[ArchiveCron] Processing campaign ${campaign._id} (${campaign.name})`);

        // Count total messages
        const totalMessages = await ContactCampaignMessage.countDocuments({ campaignId: campaign._id });
        console.log(`[ArchiveCron] Campaign has ${totalMessages} messages`);

        // Constants
        const CLOUDINARY_LIMIT_BYTES = 10485760; // 10MB
        const SAFE_ROWS_PER_FILE = 150000; // 1.5 lakh rows per file
        const ESTIMATED_BYTES_PER_ROW = 200; // Conservative estimate
        let uploadResults = [];

        // Check if chunking is needed based on message count
        const needsChunking = totalMessages > SAFE_ROWS_PER_FILE;

        if (needsChunking) {
          console.log(`[ArchiveCron] Campaign has ${totalMessages} messages, chunking required`);
          
          const totalChunks = Math.ceil(totalMessages / SAFE_ROWS_PER_FILE);
          console.log(`[ArchiveCron] Splitting into ${totalChunks} chunks (~${SAFE_ROWS_PER_FILE} rows each)`);

          // Process each chunk
          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const startRow = chunkIndex * SAFE_ROWS_PER_FILE;
            const endRow = Math.min(startRow + SAFE_ROWS_PER_FILE, totalMessages);
            const rowsInChunk = endRow - startRow;

            console.log(`[ArchiveCron] Creating chunk ${chunkIndex + 1}/${totalChunks} (rows ${startRow + 1}-${endRow})`);

            // Create workbook for this chunk
            const chunkWorkbook = new ExcelJS.Workbook();
            const chunkSheet = chunkWorkbook.addWorksheet('Campaign Messages');

            chunkSheet.columns = [
              { header: 'S.No', key: 'sno', width: 8 },
              { header: 'Phone Number', key: 'phone', width: 15 },
              { header: 'Status', key: 'status', width: 12 },
              { header: 'Template Type', key: 'templateType', width: 15 },
              { header: 'Queued At', key: 'queuedAt', width: 20 },
              { header: 'Sent At', key: 'sentAt', width: 20 },
              { header: 'Delivered At', key: 'deliveredAt', width: 20 },
              { header: 'Read At', key: 'readAt', width: 20 },
              { header: 'Failed At', key: 'failedAt', width: 20 },
              { header: 'Interactions', key: 'interactions', width: 12 },
              { header: 'Replies', key: 'replies', width: 10 },
              { header: 'User Response', key: 'userResponse', width: 30 },
              { header: 'Error', key: 'error', width: 30 }
            ];

            // Fetch messages in smaller batches to avoid memory issues
            const FETCH_BATCH_SIZE = 5000;
            let processedInChunk = 0;

            for (let batchStart = startRow; batchStart < endRow; batchStart += FETCH_BATCH_SIZE) {
              const batchLimit = Math.min(FETCH_BATCH_SIZE, endRow - batchStart);
              const messages = await ContactCampaignMessage.find({ campaignId: campaign._id })
                .skip(batchStart)
                .limit(batchLimit)
                .lean();

              const rows = messages.map((msg, idx) => ({
                sno: batchStart + idx + 1,
                phone: msg.recipientPhoneNumber || 'N/A',
                status: msg.status?.toUpperCase() || 'N/A',
                templateType: 'RCS',
                queuedAt: msg.queuedAt ? new Date(msg.queuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
                sentAt: msg.sentAt ? new Date(msg.sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
                deliveredAt: msg.deliveredAt ? new Date(msg.deliveredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
                readAt: msg.readAt ? new Date(msg.readAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
                failedAt: msg.failedAt ? new Date(msg.failedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
                interactions: msg.userClickCount || 0,
                replies: msg.userReplyCount || 0,
                userResponse: msg.userText || msg.clickedAction || msg.suggestionResponse?.plainText || 'N/A',
                error: (msg.status === 'failed' || msg.status === 'bounced') ? (msg.errorMessage || msg.errorCode || 'Unknown') : 'N/A'
              }));

              chunkSheet.addRows(rows);
              processedInChunk += messages.length;
              console.log(`[ArchiveCron] Chunk ${chunkIndex + 1}: Added ${processedInChunk}/${rowsInChunk} rows`);
            }

            // Style header
            chunkSheet.getRow(1).font = { bold: true };
            chunkSheet.getRow(1).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE0E0E0' }
            };

            // Generate buffer
            console.log(`[ArchiveCron] Chunk ${chunkIndex + 1}: Generating Excel file...`);
            const chunkBuffer = await chunkWorkbook.xlsx.writeBuffer();
            const chunkSizeMB = chunkBuffer.length / 1024 / 1024;
            console.log(`[ArchiveCron] Chunk ${chunkIndex + 1}: ${chunkSizeMB.toFixed(2)} MB`);

            if (chunkBuffer.length > CLOUDINARY_LIMIT_BYTES) {
              console.error(`[ArchiveCron] ❌ Chunk ${chunkIndex + 1} exceeds limit: ${chunkBuffer.length} > ${CLOUDINARY_LIMIT_BYTES}`);
              throw new Error(`Chunk ${chunkIndex + 1} exceeds Cloudinary limit`);
            }

            // Upload
            console.log(`[ArchiveCron] Uploading chunk ${chunkIndex + 1}/${totalChunks}...`);
            const uploadResult = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  resource_type: 'raw',
                  folder: 'archived_campaigns',
                  public_id: `campaign-${campaign.name.replace(/[^a-zA-Z0-9]/g, '_')}-${campaign._id}-part${chunkIndex + 1}-${Date.now()}`,
                  format: 'xlsx',
                  access_mode: 'public',
                  flags: 'attachment'
                },
                (error, result) => {
                  if (error) reject(error);
                  else {
                    console.log(`[ArchiveCron] Chunk ${chunkIndex + 1} uploaded: ${result.secure_url}`);
                    resolve(result);
                  }
                }
              );
              Readable.from(chunkBuffer).pipe(uploadStream);
            });

            uploadResults.push({
              url: uploadResult.secure_url,
              publicId: uploadResult.public_id,
              size: chunkBuffer.length,
              partNumber: chunkIndex + 1,
              totalParts: totalChunks,
              rowsStart: startRow + 1,
              rowsEnd: endRow
            });
          }

          console.log(`[ArchiveCron] ✅ All ${totalChunks} chunks uploaded`);
        } else {
          // Single file processing
          console.log('[ArchiveCron] Processing as single file...');
          
          const workbook = new ExcelJS.Workbook();
          const sheet = workbook.addWorksheet('Campaign Messages');

          sheet.columns = [
            { header: 'S.No', key: 'sno', width: 8 },
            { header: 'Phone Number', key: 'phone', width: 15 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Template Type', key: 'templateType', width: 15 },
            { header: 'Queued At', key: 'queuedAt', width: 20 },
            { header: 'Sent At', key: 'sentAt', width: 20 },
            { header: 'Delivered At', key: 'deliveredAt', width: 20 },
            { header: 'Read At', key: 'readAt', width: 20 },
            { header: 'Failed At', key: 'failedAt', width: 20 },
            { header: 'Interactions', key: 'interactions', width: 12 },
            { header: 'Replies', key: 'replies', width: 10 },
            { header: 'User Response', key: 'userResponse', width: 30 },
            { header: 'Error', key: 'error', width: 30 }
          ];

          // Fetch in batches
          const BATCH_SIZE = 5000;
          let processedCount = 0;

          for (let skip = 0; skip < totalMessages; skip += BATCH_SIZE) {
            const messages = await ContactCampaignMessage.find({ campaignId: campaign._id })
              .skip(skip)
              .limit(BATCH_SIZE)
              .lean();

            const rows = messages.map((msg, idx) => ({
              sno: skip + idx + 1,
              phone: msg.recipientPhoneNumber || 'N/A',
              status: msg.status?.toUpperCase() || 'N/A',
              templateType: 'RCS',
              queuedAt: msg.queuedAt ? new Date(msg.queuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              sentAt: msg.sentAt ? new Date(msg.sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              deliveredAt: msg.deliveredAt ? new Date(msg.deliveredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              readAt: msg.readAt ? new Date(msg.readAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              failedAt: msg.failedAt ? new Date(msg.failedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              interactions: msg.userClickCount || 0,
              replies: msg.userReplyCount || 0,
              userResponse: msg.userText || msg.clickedAction || msg.suggestionResponse?.plainText || 'N/A',
              error: (msg.status === 'failed' || msg.status === 'bounced') ? (msg.errorMessage || msg.errorCode || 'Unknown') : 'N/A'
            }));

            sheet.addRows(rows);
            processedCount += messages.length;
            console.log(`[ArchiveCron] Added ${processedCount}/${totalMessages} messages`);
          }

          // Style header
          sheet.getRow(1).font = { bold: true };
          sheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
          };

          // Generate buffer
          console.log('[ArchiveCron] Generating Excel file...');
          const buffer = await workbook.xlsx.writeBuffer();
          const fileSizeMB = buffer.length / 1024 / 1024;
          console.log(`[ArchiveCron] Excel file size: ${fileSizeMB.toFixed(2)} MB`);

          // Upload
          console.log('[ArchiveCron] Uploading to Cloudinary...');
          const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                resource_type: 'raw',
                folder: 'archived_campaigns',
                public_id: `campaign-${campaign.name.replace(/[^a-zA-Z0-9]/g, '_')}-${campaign._id}-${Date.now()}`,
                format: 'xlsx',
                access_mode: 'public',
                flags: 'attachment'
              },
              (error, result) => {
                if (error) reject(error);
                else {
                  console.log('[ArchiveCron] Upload success:', result.secure_url);
                  resolve(result);
                }
              }
            );
            Readable.from(buffer).pipe(uploadStream);
          });

          uploadResults.push({
            url: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            size: buffer.length,
            partNumber: 1,
            totalParts: 1,
            rowsStart: 1,
            rowsEnd: totalMessages
          });
        }

        // Verify Excel files are properly accessible
        console.log(`[ArchiveCron] 📁 Total parts: ${uploadResults.length}`);
        uploadResults.forEach((result, idx) => {
          console.log(`[ArchiveCron] 📁 Part ${idx + 1}: ${result.url}`);
          console.log(`[ArchiveCron] 📁 Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
          console.log(`[ArchiveCron] 📁 Rows: ${result.rowsStart}-${result.rowsEnd}`);
        });

        // Save archived campaign record to database
        await ArchivedCampaign.create({
          campaignId: campaign._id.toString(),
          campaignName: campaign.name,
          userId: campaign.userId._id || campaign.userId,
          userName: campaign.userId.name || 'Deleted User',
          userEmail: campaign.userId.email || 'N/A',
          botId: campaign.botId,
          excelUrl: uploadResults[0].url, // Primary URL (first part or single file)
          excelParts: uploadResults.length > 1 ? uploadResults : undefined, // Store all parts if chunked
          cloudinaryPublicId: uploadResults[0].publicId,
          fileSize: uploadResults.reduce((sum, r) => sum + r.size, 0),
          totalMessages: totalMessages,
          stats: {
            total: campaign.stats?.total || 0,
            sent: campaign.stats?.sent || 0,
            delivered: campaign.stats?.delivered || 0,
            read: campaign.stats?.read || 0,
            failed: campaign.stats?.failed || 0,
            expired: campaign.stats?.expired || 0
          },
          estimatedCost: campaign.estimatedCost || 0,
          actualCost: campaign.actualCost || 0,
          refundedAmount: campaign.refundedAmount || 0,
          campaignCreatedAt: campaign.createdAt,
          campaignCompletedAt: campaign.completedAt
        });
        console.log(`[ArchiveCron] ✅ Archived campaign ${campaign._id} (${totalMessages} messages)`);
        console.log(`[ArchiveCron] 💾 Saved archived campaign record to database`);

        // Delete messages in batches to avoid overload
        console.log('[ArchiveCron] Deleting messages in batches...');
        const DELETE_BATCH_SIZE = 5000;
        let deletedCount = 0;

        while (deletedCount < totalMessages) {
          // Find batch of message IDs
          const messagesToDelete = await ContactCampaignMessage.find({ campaignId: campaign._id })
            .select('_id')
            .limit(DELETE_BATCH_SIZE)
            .lean();

          if (messagesToDelete.length === 0) break;

          const ids = messagesToDelete.map(m => m._id);
          const result = await ContactCampaignMessage.deleteMany({ _id: { $in: ids } });
          deletedCount += result.deletedCount;

          console.log(`[ArchiveCron] Deleted ${deletedCount}/${totalMessages} messages`);
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between batches
        }

        console.log(`[ArchiveCron] ✅ Deleted ${deletedCount} messages for campaign ${campaign._id}`);

        // Delete campaign
        await Campaign.deleteOne({ _id: campaign._id });
        console.log(`[ArchiveCron] ✅ Deleted campaign ${campaign._id}`);
        console.log('---');

      } catch (error) {
        console.error(`[ArchiveCron] ❌ Error archiving campaign ${campaign._id}:`, error.message);
      }
    }

    console.log('[ArchiveCron] ✅ Archive process completed');
    await closeConnection();
    process.exit(0);

  } catch (error) {
    console.error('[ArchiveCron] ❌ Fatal error:', error);
    await closeConnection();
    process.exit(1);
  }
}

archiveOldCampaigns();
