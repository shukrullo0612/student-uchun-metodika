export const notFoundHandler = (req, res) => {
  return res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: 'Endpoint not found',
  });
};

export const errorHandler = (err, req, res, next) => {
  const status = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  return res.status(status).json({
    success: false,
    error: err.code || 'INTERNAL_ERROR',
    message,
  });
};
