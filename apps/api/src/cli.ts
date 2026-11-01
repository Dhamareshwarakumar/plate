/**
 * Operational commands, run inside the container or from apps/api:
 *
 *   node dist/cli.js reset-password   # re-seed the password from APP_INITIAL_PASSWORD(_FILE), sign out everyone
 */
import { AuthBootstrapError, AuthService } from './auth/service.js';
import { SessionStore } from './auth/sessions.js';
import { ConfigError, loadConfig } from './config.js';
import { openDb } from './db/index.js';

const USAGE = `Usage: plate-cli <command>

Commands:
  reset-password   Overwrite the app password with APP_INITIAL_PASSWORD (or the contents of
                   APP_INITIAL_PASSWORD_FILE) and sign out every session.
`;

async function resetPassword(): Promise<void> {
  const config = loadConfig();
  const opened = openDb({ path: config.databasePath, migrationsDir: config.migrationsDir });
  try {
    const service = new AuthService(opened.db, new SessionStore(opened.db, config.sessionTtlMs));
    const { revokedSessions } = await service.resetFromBootstrap(config.initialPassword);
    console.log(
      `Password reset from the bootstrap value. Signed out ${revokedSessions} session(s). ` +
        'Sign in and change it in Settings → Security.',
    );
  } finally {
    opened.close();
  }
}

async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  switch (command) {
    case 'reset-password':
      await resetPassword();
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      process.exit(2);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof AuthBootstrapError) {
    console.error(`\n${err.name}: ${err.message}\n`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
