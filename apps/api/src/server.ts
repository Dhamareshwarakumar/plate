import { buildAppWithServices } from './app.js';
import { AuthBootstrapError, AuthService } from './auth/service.js';
import { SessionStore } from './auth/sessions.js';
import { CategoryService } from './categories/service.js';
import { ConfigError, loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { MealSlotService } from './mealSlots/service.js';
import { ReminderScheduler } from './reminders/scheduler.js';
import { APP_VERSION } from './version.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const opened = openDb({ path: config.databasePath, migrationsDir: config.migrationsDir });

  // Bootstrap before listening: the server never accepts a request without a password in place.
  const bootstrapAuth = new AuthService(
    opened.db,
    new SessionStore(opened.db, config.sessionTtlMs),
  );
  const bootstrapResult = await bootstrapAuth.bootstrap(config.initialPassword);

  const seededCategories = new CategoryService(opened.db).seedDefaults();
  const seededMealSlots = new MealSlotService(opened.db).seedDefaults();

  const { app, services } = await buildAppWithServices({
    config,
    db: opened.db,
    sqlite: opened.sqlite,
  });
  if (seededCategories > 0) app.log.info({ seededCategories }, 'seeded default categories');
  if (seededMealSlots > 0) app.log.info({ seededMealSlots }, 'seeded default meal slots');

  if (bootstrapResult === 'seeded_from_bootstrap') {
    app.log.warn(
      'App password seeded from APP_INITIAL_PASSWORD. Change it in Settings → Security after signing in.',
    );
  }

  const purged = new SessionStore(opened.db, config.sessionTtlMs).purgeExpired();
  if (purged > 0) app.log.info({ purged }, 'removed expired sessions');

  // Reminders (FR-N) run in-process: one tick a minute, never in tests (they call tick() directly).
  const scheduler = new ReminderScheduler({ ...services, logger: app.log });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    scheduler.stop();
    await app.close();
    opened.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  scheduler.start();
  app.log.info(
    { host: config.host, port: config.port, database: config.databasePath, version: APP_VERSION },
    'plate api ready',
  );
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof AuthBootstrapError) {
    console.error(`\n${err.name}: ${err.message}\n`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
