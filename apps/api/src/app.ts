import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import authPlugin from './auth/plugin.js';
import { AuthService } from './auth/service.js';
import { SessionStore } from './auth/sessions.js';
import { FailureThrottle } from './auth/throttle.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/index.js';
import { errorBody, errorHandler } from './errors.js';
import { PASSWORD_THROTTLE, protectedAuthRoutes, publicAuthRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
  sqlite: Database.Database;
  /** Overrides for tests. */
  logger?: boolean | object;
  rateLimitMax?: number;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
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

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
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

  await app.register(fastifyRateLimit, {
    global: true,
    max: options.rateLimitMax ?? 300,
    timeWindow: '1 minute',
  });

  const sessionStore = new SessionStore(db, config.sessionTtlMs);
  const authService = new AuthService(db, sessionStore);
  await app.register(authPlugin, { config, authService, sessionStore });

  const passwordThrottle = new FailureThrottle(
    PASSWORD_THROTTLE.maxFailures,
    PASSWORD_THROTTLE.windowMs,
  );

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { sqlite });
      await api.register(publicAuthRoutes, { throttle: passwordThrottle });

      await api.register(async (guarded) => {
        guarded.addHook('preHandler', guarded.requireSession);
        await guarded.register(protectedAuthRoutes, { throttle: passwordThrottle });
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

  return app;
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
