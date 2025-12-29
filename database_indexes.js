// Database indexes for 1 lakh+ message optimization
// Run these in MongoDB shell or add to your migration script

// Message collection indexes
db.messages.createIndex({ "campaignId": 1, "status": 1 });
db.messages.createIndex({ "messageId": 1 }, { unique: true });
db.messages.createIndex({ "recipientPhoneNumber": 1 });
db.messages.createIndex({ "createdAt": -1 });
db.messages.createIndex({ "userId": 1, "createdAt": -1 });

// Campaign collection indexes  
db.campaigns.createIndex({ "userId": 1, "createdAt": -1 });
db.campaigns.createIndex({ "status": 1 });
db.campaigns.createIndex({ "userId": 1, "status": 1 });

// APIResult collection indexes (if keeping detailed logs)
db.apiresults.createIndex({ "messageId": 1 });
db.apiresults.createIndex({ "campaignId": 1, "createdAt": -1 });
db.apiresults.createIndex({ "userId": 1, "createdAt": -1 });

// Template collection indexes
db.templates.createIndex({ "userId": 1, "createdAt": -1 });

// Compound indexes for complex queries
db.messages.createIndex({ "campaignId": 1, "status": 1, "createdAt": -1 });
db.campaigns.createIndex({ "userId": 1, "status": 1, "createdAt": -1 });

// TTL index for cleaning old API results (optional - keeps only 30 days)
db.apiresults.createIndex({ "createdAt": 1 }, { expireAfterSeconds: 2592000 });

console.log("Database indexes created for high-volume message handling");