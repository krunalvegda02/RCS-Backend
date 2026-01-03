import Template from '../models/template.model.js';
import { validateTemplateContent } from '../utils/validators.js';

// Create new template
export const create = async (req, res) => {
  try {
    const { name, description, templateType, content, variables } = req.body;
    const userId = req.user._id;

    if (!validateTemplateContent(templateType, content)) {
      return res.status(400).json({
        success: false,
        message: `Invalid content structure for ${templateType}`,
      });
    }

    const template = await Template.create({
      name,
      description,
      templateType,
      content,
      variables: variables || [],
      userId,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get all templates for user
export const getAll = async (req, res) => {
  try {
    const userId = req.user._id;
    const { templateType, isActive, search } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    let query = { userId, isActive: isActive !== 'false' };
    if (templateType) query.templateType = templateType;
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'content.body': { $regex: search, $options: 'i' } },
        { 'content.text': { $regex: search, $options: 'i' } },
        { 'content.title': { $regex: search, $options: 'i' } }
      ];
    }

    const templates = await Template.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await Template.countDocuments(query);

    res.json({
      success: true,
      data: templates,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get single template
export const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const template = await Template.getValidTemplate(id, userId);

    res.json({
      success: true,
      data: template,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

// Update template
export const update = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updates = req.body;

    if (updates.content) {
      const template = await Template.findById(id);
      if (!validateTemplateContent(template.templateType, updates.content)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid content structure',
        });
      }
    }

    const template = await Template.findOneAndUpdate(
      { _id: id, userId },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    res.json({
      success: true,
      message: 'Template updated successfully',
      data: template,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete template
export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const template = await Template.findOneAndDelete({
      _id: id,
      userId,
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    res.json({
      success: true,
      message: 'Template deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get templates by type
export const getByType = async (req, res) => {
  try {
    const { type } = req.params;
    const userId = req.user._id;
    const validTypes = ['richCard', 'carousel', 'textWithAction', 'plainText'];

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template type',
      });
    }

    const templates = await Template.find({
      userId,
      templateType: type,
      isActive: true,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Approve template (Admin only)
export const approve = async (req, res) => {
  try {
    const { id } = req.params;

    const template = await Template.findByIdAndUpdate(
      id,
      {
        isApproved: true,
        approvedAt: new Date(),
        approvedBy: req.user._id,
      },
      { new: true }
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }

    res.json({
      success: true,
      message: 'Template approved successfully',
      data: template,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

