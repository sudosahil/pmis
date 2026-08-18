import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/document.controller.js';
import * as documentService from '../services/document.service.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { badRequest } from '../utils/errors.js';

/**
 * Uploads are buffered in memory and written by the service once the bytes have
 * been checksummed. The limits below are the outer wall — the service checks
 * type and size again before anything reaches the disk.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: documentService.MAX_UPLOAD_BYTES,
    files: 1,
    // Enough for the metadata fields, and no more.
    fields: 12,
    fieldSize: 2000,
  },
  fileFilter: (_req, file, callback) => {
    if (!documentService.isAcceptedUpload(file.mimetype, file.originalname)) {
      callback(
        badRequest(
          `That file type is not accepted. Allowed types: ${documentService.describeAcceptedTypes()}.`,
        ),
      );
      return;
    }
    callback(null, true);
  },
});

export const documentRouter = Router();
documentRouter.use(authenticate);

documentRouter.get('/summary', asyncHandler(controller.summary));

// --- Folders ---------------------------------------------------------------

documentRouter.get(
  '/folders',
  validate(controller.folderQuerySchema, 'query'),
  asyncHandler(controller.listFolders),
);
documentRouter.get('/folders/:id/path', asyncHandler(controller.folderBreadcrumb));
documentRouter.post(
  '/folders',
  validate(documentService.folderSchema),
  asyncHandler(controller.createFolder),
);
documentRouter.patch(
  '/folders/:id',
  validate(documentService.updateFolderSchema),
  asyncHandler(controller.updateFolder),
);
documentRouter.delete('/folders/:id', asyncHandler(controller.removeFolder));

// --- Files -----------------------------------------------------------------

documentRouter.get(
  '/',
  validate(documentService.listQuerySchema, 'query'),
  asyncHandler(controller.list),
);
documentRouter.post('/', upload.single('file'), asyncHandler(controller.upload));
documentRouter.get('/:id', asyncHandler(controller.getOne));
documentRouter.get('/:id/download', asyncHandler(controller.download));
documentRouter.patch(
  '/:id',
  validate(documentService.updateDocumentSchema),
  asyncHandler(controller.update),
);
documentRouter.delete('/:id', asyncHandler(controller.remove));
