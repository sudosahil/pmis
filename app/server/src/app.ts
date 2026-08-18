import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/error.js';
import { authRouter } from './routes/auth.routes.js';
import { masterRouter } from './routes/master.routes.js';
import { contractorRouter } from './routes/contractor.routes.js';
import { packageRouter, projectRouter } from './routes/project.routes.js';
import { tenderRouter } from './routes/tender.routes.js';
import { miscBillRouter, raBillRouter } from './routes/bill.routes.js';
import { workflowRouter } from './routes/workflow.routes.js';
import { auditRouter, dashboardRouter, notificationRouter } from './routes/dashboard.routes.js';
import { userRouter } from './routes/user.routes.js';
import { fundRouter } from './routes/fund.routes.js';
import { documentRouter } from './routes/document.routes.js';
import { chatRouter } from './routes/chat.routes.js';
import { activityRouter } from './routes/activity.routes.js';
import { activityLogger } from './middleware/activity.js';

export function createApp(): express.Express {
  // Opening the database here means a misconfigured path fails at boot.
  getDb();

  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(requestId);
  // Registered before the routers so it can time the whole handler, and reads
  // req.user on the way out, once `authenticate` has attached it.
  app.use(activityLogger);

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: env.isTest ? 100_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        data: null,
        error: { message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' },
      },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ data: { status: 'ok', service: 'pmis-api', time: new Date().toISOString() }, error: null });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/masters', masterRouter);
  app.use('/api/contractors', contractorRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/packages', packageRouter);
  app.use('/api/tenders', tenderRouter);
  app.use('/api/ra-bills', raBillRouter);
  app.use('/api/misc-bills', miscBillRouter);
  app.use('/api/approvals', workflowRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/users', userRouter);
  app.use('/api/funds', fundRouter);
  app.use('/api/documents', documentRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/activity', activityRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
