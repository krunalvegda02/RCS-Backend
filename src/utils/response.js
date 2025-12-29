// src/utils/response.js
import MESSAGE from '../constants/message.js';

const successResponse = (res, data, message = MESSAGE.SUCCESS, statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const errorResponse = (res, message = MESSAGE.INTERNAL_ERROR, statusCode = 500, error = null) => {
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && error && { error: error.message }),
  });
};


export { successResponse, errorResponse };

