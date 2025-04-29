import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

interface ValidationSchema {
  body?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
}

type RequestHandler = (req: Request, res: Response, next: NextFunction) => void;

export const validateRequest = (schema: ValidationSchema): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    const validationOptions = {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: true
    };

    const toValidate = {
      body: req.body,
      params: req.params,
      query: req.query
    };

    const { error, value } = Joi.object({
      body: schema.body || Joi.object(),
      params: schema.params || Joi.object(),
      query: schema.query || Joi.object()
    }).validate(toValidate, validationOptions);

    if (error) {
      const errorMessage = error.details
        .map((detail) => detail.message)
        .join(', ');
      
      return res.status(400).json({
        error: {
          message: 'Validation Error',
          details: errorMessage
        }
      });
    }

    // Replace request data with validated data
    if (value.body) req.body = value.body;
    if (value.params) req.params = value.params;
    if (value.query) req.query = value.query;

    next();
  };
}; 