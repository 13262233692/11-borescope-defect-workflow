const Joi = require('joi');

const schemas = {
  login: Joi.object({
    username: Joi.string().required().trim().min(3).max(50),
    password: Joi.string().required().min(6).max(128)
  }),

  createCase: Joi.object({
    caseNumber: Joi.string().required().trim().min(3).max(50),
    engineId: Joi.string().uuid().required(),
    inspectionDate: Joi.date().iso().required(),
    inspectionType: Joi.string().required().max(50),
    borescopeModel: Joi.string().allow('').max(100),
    section: Joi.string().required().max(100),
    stage: Joi.string().allow('').max(50),
    location: Joi.string().allow('').max(200),
    summary: Joi.string().allow(''),
    inspectorId: Joi.string().uuid()
  }),

  updateCase: Joi.object({
    summary: Joi.string().allow(''),
    conclusion: Joi.string().allow(''),
    section: Joi.string().max(100),
    stage: Joi.string().allow('').max(50),
    location: Joi.string().allow('').max(200)
  }),

  createAnnotation: Joi.object({
    caseId: Joi.string().uuid().required(),
    imageId: Joi.string().uuid().required(),
    defectType: Joi.string().valid('CRACK', 'CORROSION', 'DEFORMATION', 'DEBRIS', 'BURN', 'WEAR', 'OTHER').required(),
    severity: Joi.string().valid('MINOR', 'MODERATE', 'MAJOR', 'CRITICAL').required(),
    description: Joi.string().allow(''),
    x1: Joi.number().min(0).max(1).required(),
    y1: Joi.number().min(0).max(1).required(),
    x2: Joi.number().min(0).max(1).required(),
    y2: Joi.number().min(0).max(1).required(),
    polygon: Joi.array().items(Joi.object({ x: Joi.number(), y: Joi.number() })),
    measurement: Joi.number().positive().allow(null),
    measurementUnit: Joi.string().allow('').max(20),
    conflictToken: Joi.string().uuid()
  }),

  updateAnnotation: Joi.object({
    defectType: Joi.string().valid('CRACK', 'CORROSION', 'DEFORMATION', 'DEBRIS', 'BURN', 'WEAR', 'OTHER'),
    severity: Joi.string().valid('MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'),
    description: Joi.string().allow(''),
    x1: Joi.number().min(0).max(1),
    y1: Joi.number().min(0).max(1),
    x2: Joi.number().min(0).max(1),
    y2: Joi.number().min(0).max(1),
    polygon: Joi.array().items(Joi.object({ x: Joi.number(), y: Joi.number() })),
    measurement: Joi.number().positive().allow(null),
    measurementUnit: Joi.string().allow('').max(20),
    version: Joi.number().integer().positive(),
    updatedAt: Joi.date().iso(),
    conflictToken: Joi.string().uuid()
  }),

  syncAnnotationCreate: Joi.object({
    op: Joi.string().valid('create').required(),
    tempId: Joi.string().max(100),
    caseId: Joi.string().uuid().required(),
    imageId: Joi.string().uuid().required(),
    defectType: Joi.string().valid('CRACK', 'CORROSION', 'DEFORMATION', 'DEBRIS', 'BURN', 'WEAR', 'OTHER').required(),
    severity: Joi.string().valid('MINOR', 'MODERATE', 'MAJOR', 'CRITICAL').required(),
    description: Joi.string().allow(''),
    x1: Joi.number().min(0).max(1).required(),
    y1: Joi.number().min(0).max(1).required(),
    x2: Joi.number().min(0).max(1).required(),
    y2: Joi.number().min(0).max(1).required(),
    polygon: Joi.array().items(Joi.object({ x: Joi.number(), y: Joi.number() })),
    measurement: Joi.number().positive().allow(null),
    measurementUnit: Joi.string().allow('').max(20),
    clientUpdatedAt: Joi.date().iso()
  }),

  syncAnnotationUpdate: Joi.object({
    op: Joi.string().valid('update').required(),
    id: Joi.string().uuid().required(),
    version: Joi.number().integer().positive().required(),
    conflictToken: Joi.string().uuid().required(),
    updatedAt: Joi.date().iso(),
    defectType: Joi.string().valid('CRACK', 'CORROSION', 'DEFORMATION', 'DEBRIS', 'BURN', 'WEAR', 'OTHER'),
    severity: Joi.string().valid('MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'),
    description: Joi.string().allow(''),
    x1: Joi.number().min(0).max(1),
    y1: Joi.number().min(0).max(1),
    x2: Joi.number().min(0).max(1),
    y2: Joi.number().min(0).max(1),
    polygon: Joi.array().items(Joi.object({ x: Joi.number(), y: Joi.number() })),
    measurement: Joi.number().positive().allow(null),
    measurementUnit: Joi.string().allow('').max(20),
    clientUpdatedAt: Joi.date().iso()
  }),

  syncAnnotationDelete: Joi.object({
    op: Joi.string().valid('delete').required(),
    id: Joi.string().uuid().required(),
    version: Joi.number().integer().positive(),
    conflictToken: Joi.string().uuid(),
    updatedAt: Joi.date().iso(),
    clientUpdatedAt: Joi.date().iso()
  }),

  syncAnnotations: Joi.object({
    operations: Joi.array()
      .items(Joi.object({}).unknown(true))
      .min(1)
      .max(200)
      .required(),
    imageId: Joi.string().uuid(),
    caseSyncVersion: Joi.number().integer().positive(),
    autoMerge: Joi.boolean().default(true)
  })

  workflowAction: Joi.object({
    action: Joi.string().valid(
      'SUBMIT', 'REVIEW_PASS', 'REVIEW_REJECT', 'RELEASE', 'CLOSE', 'COMMENT'
    ).required(),
    comment: Joi.string().allow(''),
    targetStatus: Joi.string().valid('REPAIR', 'CLEAR'),
    reviewDecision: Joi.string().valid('REPAIR', 'CLEAR')
  })
};

function validate(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) {
      return next();
    }

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));
      return next(require('../utils/errors').ValidationError(
        `请求参数校验失败 (${details.length} 个错误)`,
        details
      ));
    }

    req.body = value;
    next();
  };
}

module.exports = { validate, schemas };
