
import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema(
  {
    // Basic Info
    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      maxlength: [100, 'Template name cannot exceed 100 characters'],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },

    // Template Type (critical for validation)
    templateType: {
      type: String,
      enum: ['richCard', 'carousel', 'textWithAction', 'plainText'],
      required: [true, 'Template type is required'],
      index: true,
    },

    // Owner & Access Control
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Template Content (flexible structure based on type)
    content: {
      // For Rich Card
      title: String,
      subtitle: String,
      description: String,
      imageUrl: String,
      actions: [
        {
          label: String,
          uri: String,
          actionType: {
            type: String,
            enum: ['openUri', 'postback', 'dialPhone'],
          },
        },
      ],

      // For Carousel
      cards: [
        {
          title: String,
          subtitle: String,
          description: String,
          imageUrl: String,
          actions: [
            {
              label: String,
              uri: String,
              actionType: String,
            },
          ],
        },
      ],

      // For Text with Action
      text: String,
      buttons: [
        {
          label: String,
          value: String,
          actionType: String,
        },
      ],

      // For Plain Text
      body: String,
    },

    // Validation & Status
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    approvedAt: Date,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // Usage Statistics
    usageCount: {
      type: Number,
      default: 0,
    },
    successRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    totalMessagesSent: {
      type: Number,
      default: 0,
    },


    // Audit Trail
    lastUsedAt: Date,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    collection: 'templates',
  }
);

// Indexes for performance
templateSchema.index({ userId: 1, isActive: 1 });
templateSchema.index({ templateType: 1, isApproved: 1 });
templateSchema.index({ createdAt: -1 });

// Pre-save validation
templateSchema.pre('save', function (next) {
  // Validate content based on templateType
  this.validateContentStructure();
  next();
});

// Instance method to validate content
templateSchema.methods.validateContentStructure = function () {
  const { templateType, content } = this;

  if (!content) throw new Error('Content is required');

  switch (templateType) {
    case 'richCard':
      if (!content.title) throw new Error('Rich card requires title');
      if (!content.imageUrl) throw new Error('Rich card requires image URL');
      break;

    case 'carousel':
      if (!Array.isArray(content.cards) || content.cards.length === 0) {
        throw new Error('Carousel requires at least one card');
      }
      if (content.cards.length > 10) {
        throw new Error('Carousel cannot have more than 10 cards');
      }
      break;

    case 'textWithAction':
      if (!content.text) throw new Error('Text with action requires text');
      if (!Array.isArray(content.buttons) || content.buttons.length === 0) {
        throw new Error('Text with action requires at least one button');
      }
      if (content.buttons.length > 4) {
        throw new Error('Maximum 4 buttons allowed');
      }
      break;

    case 'plainText':
      if (!content.body) throw new Error('Plain text requires body');
      if (content.body.length > 1000) {
        throw new Error('Plain text cannot exceed 1000 characters');
      }
      break;
  }
};

// Static method to get template with validation
templateSchema.statics.getValidTemplate = async function (templateId, userId) {
  const template = await this.findOne({
    _id: templateId,
    userId: userId,
    isActive: true,
  });

  if (!template) {
    throw new Error('Template not found or inactive');
  }

  return template;
};

// Method to increment usage
templateSchema.methods.incrementUsage = async function () {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  await this.save();
};

export default mongoose.model('Template', templateSchema);