// src/app.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';

import { initDb } from './models/index.js';
import { attachCurrentUser } from './middleware/auth.js';
import { attachCsrfToken, verifyCsrfToken } from './middleware/csrf.js';
import adminAuditRoutes from './routes/adminAudit.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import reviewRoutes from './routes/reviews.js';
import staffRoutes from './routes/staff.js';
import goalRoutes from './routes/goals.js';
import calendarRoutes from './routes/calendar.js';
import exportRoutes from './routes/exports.js';
import metricAdminRoutes from './routes/metricAdmin.js';
import adminUserRoutes from './routes/adminUsers.js';
import assignmentsRouter from './routes/assignments.js';
import incidentsRouter from './routes/incidents.js';
import meetingsRouter from './routes/meetings.js';
import trainingRouter from './routes/training.js';
import esdRouter from './routes/esd.js';
import attendanceRoutes from './routes/attendance.js';
import rackAssignmentRoutes from './routes/rackAssignments.js';
import importsRouter from './routes/imports.js';
import rosterRoutes from './routes/roster.js';
import searchRoutes from './routes/search.js';

const app = express();
const PORT = process.env.PORT || 3377;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─────────────────────────────────────────────
 * Core middleware
 * ───────────────────────────────────────────── */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (process.env.NODE_ENV !== 'production' && filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

/* ─────────────────────────────────────────────
 * Session
 * ───────────────────────────────────────────── */
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET env var is missing or too short (min 32 chars). Refusing to start in production.');
    process.exit(1);
  } else {
    console.warn('WARNING: SESSION_SECRET not set or too short — using insecure default. Set SESSION_SECRET in your .env for any real deployment.');
  }
}

app.use(
  session({
    secret: SESSION_SECRET || 'dev-only-insecure-secret-change-before-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production', // enforce HTTPS in production
    },
  })
);

/* ─────────────────────────────────────────────
 * CSP
 * ───────────────────────────────────────────── */
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      `connect-src 'self' ws: http://localhost:${PORT}`,
      "font-src 'self' data:",
      "frame-ancestors 'self'",
    ].join('; ')
  );
  next();
});

/* ─────────────────────────────────────────────
 * Views
 * ───────────────────────────────────────────── */
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

/* ─────────────────────────────────────────────
 * Auth locals
 * ───────────────────────────────────────────── */
app.use(attachCurrentUser);
app.use(attachCsrfToken);
app.use(verifyCsrfToken);

app.use((req, res, next) => {
  res.locals.currentUser = req.currentUser || null;
  res.locals.user = req.currentUser || null; // backward-compatible for older EJS usage
  res.locals.path = req.path || '';
  next();
});

/* ─────────────────────────────────────────────
 * Routes
 * ───────────────────────────────────────────── */
app.use('/', authRoutes);
app.use('/', dashboardRoutes);

// Feature routes
app.use('/assignments', assignmentsRouter);
app.use('/incidents', incidentsRouter);
app.use('/meetings', meetingsRouter);

// Training remains mounted, but is now intended to be accessed through Imports
// rather than through top-level navigation.
app.use('/training', trainingRouter);

app.use('/esd', esdRouter);
app.use('/attendance', attendanceRoutes);
app.use('/rack-assignments', rackAssignmentRoutes);
app.use('/metrics', metricAdminRoutes);
app.use('/imports', importsRouter);
app.use('/roster', rosterRoutes);

// Admin routes
app.use('/admin/users', adminUserRoutes);
app.use('/admin/audit', adminAuditRoutes);

// Core app routes
app.use('/reviews', reviewRoutes);
app.use('/staff', staffRoutes);
app.use('/goals', goalRoutes);
app.use('/calendar', calendarRoutes);
app.use('/exports', exportRoutes);
app.use('/search', searchRoutes);

// Serve uploads only to authenticated users
app.use('/uploads', (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}, express.static(path.join(process.cwd(), 'uploads')));

/* ─────────────────────────────────────────────
 * 404
 * ───────────────────────────────────────────── */
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not Found',
    message: 'Page not found',
    status: 404,
    error: null,
  });
});

/* ─────────────────────────────────────────────
 * Error handler
 * ───────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('APP ERROR:', err);

  res.status(err.status || 500).render('error', {
    title: 'Application Error',
    message: err.message || 'Internal Server Error',
    status: err.status || 500,
    error: process.env.NODE_ENV === 'development' ? err : null,
  });
});

/* ─────────────────────────────────────────────
 * Start
 * ───────────────────────────────────────────── */
(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Manager tool running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize application:', err);
    process.exit(1);
  }
})();

export default app;