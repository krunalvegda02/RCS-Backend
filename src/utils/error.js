
// src/utils/errors.js
import MESSAGE from '../constants/message.js';

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = MESSAGE.VALIDATION_ERROR) {
    super(message, 400);
  }
}

class NotFoundError extends AppError {
  constructor(message = MESSAGE.NOT_FOUND) {
    super(message, 404);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = MESSAGE.UNAUTHORIZED) {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = MESSAGE.FORBIDDEN) {
    super(message, 403);
  }
}

export {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
};
