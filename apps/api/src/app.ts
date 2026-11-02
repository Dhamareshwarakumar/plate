import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createAiProvider } from './ai/providers/index.js';
import { AiService } from './ai/service.js';
import authPlugin from './auth/plugin.js';
import { AuthService } from './auth/service.js';
import { SessionStore } from './auth/sessions.js';
import { FailureThrottle } from './auth/throttle.js';
import { BackupService } from './backup/service.js';
import { CategoryService } from './categories/service.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/index.js';
import { DiaryService } from './diary/service.js';
import { DishService } from './dishes/service.js';
import { errorBody, errorHandler } from './errors.js';
import { FoodService } from './foods/service.js';
import { GoalService } from './goals/service.js';
import { InsightsService } from './insights/service.js';
import { MealSlotService } from './mealSlots/service.js';
import { MealTemplateService } from './mealTemplates/service.js';
import { OffLookupService } from './off/service.js';
import { PushService } from './push/service.js';
import { ReminderService } from './reminders/service.js';
import { aboutRoutes } from './routes/about.js';
import { aiRoutes } from './routes/ai.js';
import { PASSWORD_THROTTLE, protectedAuthRoutes, publicAuthRoutes } from './routes/auth.js';
import { backupRoutes } from './routes/backup.js';
import { categoryRoutes } from './routes/categories.js';
import { diaryRoutes } from './routes/diary.js';
import { dishRoutes } from './routes/dishes.js';
import { foodRoutes } from './routes/foods.js';
import { goalRoutes } from './routes/goals.js';
import { healthRoutes } from './routes/health.js';
import { insightsRoutes } from './routes/insights.js';
import { mealSlotRoutes } from './routes/mealSlots.js';
import { mealTemplateRoutes } from './routes/mealTemplates.js';
import { offRoutes } from './routes/off.js';
import { pushRoutes } from './routes/push.js';
import { reminderRoutes } from './routes/reminders.js';
import { settingsRoutes } from './routes/settings.js';
import { waterRoutes } from './routes/water.js';
import { weightRoutes } from './routes/weights.js';
import { SettingsService } from './settings/service.js';
import { WaterService } from './water/service.js';
import { WeightService } from './weights/service.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
  sqlite: Database.Database;
  /** Overrides for tests. */
  logger?: boolean | object;
  rateLimitMax?: number;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The app plus the services server.ts needs outside request handling (the reminder scheduler). */
export interface BuiltApp {
  app: FastifyInstance;
  services: {
    reminders: ReminderService;
    mealSlots: MealSlotService;
    push: PushService;
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  return (await buildAppWithServices(options)).app;
}

export async function buildAppWithServices(options: BuildAppOptions): Promise<BuiltApp> {
  const { config, db, sqlite } = options;

  const app = Fastify({
    logger: options.logger ?? {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      ...(config.nodeEnv === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  // CSV uploads arrive as plain text; JSON stays the default for everything else.
  app.addContentTypeParser(
    ['text/csv', 'text/plain'],
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        // 'wasm-unsafe-eval' (CSP3) lets the browser compile WebAssembly, which the barcode
        // scanner's zxing-wasm fallback needs where there is no native BarcodeDetector (D163). It
        // does not permit eval()/new Function(); the .wasm bytes come from this origin only
        // (connect-src 'self'). Inline scripts stay forbidden.
        'script-src': ["'self'", "'wasm-unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'manifest-src': ["'self'"],
        'worker-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });

  const sessionStore = new SessionStore(db, config.sessionTtlMs);
  const authService = new AuthService(db, sessionStore);
  await app.register(authPlugin, { config, authService, sessionStore });

  const passwordThrottle = new FailureThrottle(
    PASSWORD_THROTTLE.maxFailures,
    PASSWORD_THROTTLE.windowMs,
  );
  const categoryService = new CategoryService(db);
  const foodService = new FoodService(db);
  const mealSlotService = new MealSlotService(db);
  const settingsService = new SettingsService(db);
  const goalService = new GoalService(db);
  const waterService = new WaterService(db);
  const weightService = new WeightService(db, goalService);
  const diaryService = new DiaryService(db, {
    goals: goalService,
    settings: settingsService,
    water: waterService,
  });
  const dishService = new DishService(db, foodService);
  const mealTemplateService = new MealTemplateService(db, diaryService);
  const insightsService = new InsightsService(db, {
    goals: goalService,
    settings: settingsService,
    weights: weightService,
  });
  const backupService = new BackupService({
    db,
    sqlite,
    dbPath: config.databasePath,
    categories: categoryService,
    mealSlots: mealSlotService,
  });
  const offService = new OffLookupService({
    enabled: config.offLookupEnabled,
    userAgent: config.offUserAgent,
    logger: app.log,
  });
  const pushService = new PushService(db, {
    vapidSubject: config.pushVapidSubject,
    logger: app.log,
  });
  const reminderService = new ReminderService(db, {
    mealSlots: mealSlotService,
    goals: goalService,
  });
  // AI assistance (Phase 11): null provider when AI_PROVIDER=none; the routes then answer 404.
  const aiProvider = createAiProvider(config, app.log);
  const aiService = new AiService(db, {
    provider: aiProvider,
    foods: foodService,
    diary: diaryService,
    mealSlots: mealSlotService,
    insights: insightsService,
    settings: settingsService,
    maxImageBytes: config.aiMaxImageBytes,
    logger: app.log,
  });

  await app.register(
    async (api) => {
      // Scoped to /api: the static shell is public and a service-worker precache legitimately
      // fetches ~80 files in one burst, which must not eat into the API budget of one device.
      await api.register(fastifyRateLimit, {
        global: true,
        max: options.rateLimitMax ?? 300,
        timeWindow: '1 minute',
      });
      await api.register(healthRoutes, { sqlite });
      await api.register(publicAuthRoutes, { throttle: passwordThrottle });

      await api.register(async (guarded) => {
        // onRequest: anonymous requests are refused before any body is parsed or validated.
        guarded.addHook('onRequest', guarded.requireSession);
        await guarded.register(protectedAuthRoutes, { throttle: passwordThrottle });
        await guarded.register(categoryRoutes, { categories: categoryService });
        await guarded.register(foodRoutes, { foods: foodService, categories: categoryService });
        await guarded.register(mealSlotRoutes, { mealSlots: mealSlotService });
        await guarded.register(diaryRoutes, { diary: diaryService });
        await guarded.register(dishRoutes, { dishes: dishService });
        await guarded.register(mealTemplateRoutes, { mealTemplates: mealTemplateService });
        await guarded.register(settingsRoutes, { settings: settingsService });
        await guarded.register(goalRoutes, {
          goals: goalService,
          settings: settingsService,
          weights: weightService,
        });
        await guarded.register(waterRoutes, { water: waterService });
        await guarded.register(weightRoutes, { weights: weightService });
        await guarded.register(insightsRoutes, { insights: insightsService });
        await guarded.register(backupRoutes, { backup: backupService });
        await guarded.register(aboutRoutes, {
          backup: backupService,
          offEnabled: config.offLookupEnabled,
          ai: {
            enabled: aiProvider !== null,
            provider: config.aiProvider,
            model: aiProvider?.model ?? null,
          },
        });
        await guarded.register(offRoutes, { off: offService });
        await guarded.register(reminderRoutes, { reminders: reminderService });
        await guarded.register(pushRoutes, { push: pushService });
        await guarded.register(aiRoutes, { ai: aiService, maxImageBytes: config.aiMaxImageBytes });
      });
    },
    { prefix: '/api' },
  );

  if (config.webDistDir) {
    await registerWebApp(app, config.webDistDir);
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || !config.webDistDir || request.method !== 'GET') {
      void reply
        .status(404)
        .send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
      return;
    }
    // SPA fallback: client-side routes resolve to the shell, which must never be cached stale.
    void reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html');
  });

  return {
    app,
    services: { reminders: reminderService, mealSlots: mealSlotService, push: pushService },
  };
}

async function registerWebApp(app: FastifyInstance, webDistDir: string): Promise<void> {
  const root = resolve(webDistDir);
  if (!existsSync(join(root, 'index.html'))) {
    app.log.warn({ root }, 'WEB_DIST_DIR has no index.html; serving API only');
    return;
  }
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    index: ['index.html'],
    setHeaders: (reply, filePath) => {
      // Vite emits content-hashed files under /assets; everything else may change between deploys.
      const immutable = filePath.startsWith(`${join(root, 'assets')}/`);
      void reply.header(
        'Cache-Control',
        immutable ? `public, max-age=${ONE_YEAR_SECONDS}, immutable` : 'no-cache',
      );
    },
  });
}
