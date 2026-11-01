import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';
import { AppError, errorBody } from '../errors.js';
import type { AuthService } from './service.js';
import type { Session, SessionStore } from './sessions.js';

export const SESSION_COOKIE = 'plate_session';

declare module 'fastify' {
  interface FastifyRequest {
    /** Present on routes guarded by `requireSession`. */
    session: Session | undefined;
    sessionToken: string | undefined;
  }
  interface FastifyInstance {
    authService: AuthService;
    sessionStore: SessionStore;
    /** Request hook (onRequest) that rejects requests without a live session (401 + WWW-Authenticate). */
    requireSession: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<FastifyReply | undefined>;
    setSessionCookie: (
      reply: FastifyReply,
      request: FastifyRequest,
      token: string,
      expiresAt: string,
    ) => void;
    clearSessionCookie: (reply: FastifyReply, request: FastifyRequest) => void;
  }
}

export interface AuthPluginOptions {
  config: Pick<AppConfig, 'cookieSecure'>;
  authService: AuthService;
  sessionStore: SessionStore;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isSecureRequest(request: FastifyRequest, mode: AppConfig['cookieSecure']): boolean {
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  return request.protocol === 'https';
}

/**
 * Defence in depth next to SameSite=Strict: a mutating request whose Origin (or Sec-Fetch-Site)
 * says it came from another site is rejected before any handler runs.
 */
function assertSameOrigin(request: FastifyRequest): void {
  if (!MUTATING_METHODS.has(request.method)) return;

  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') {
    throw new AppError(403, 'FORBIDDEN', 'Cross-site requests are not allowed');
  }

  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return;
  let requestOrigin: string;
  let callerOrigin: string;
  try {
    // Normalising through URL drops default ports so "http://host:80" and "http://host" agree.
    callerOrigin = new URL(origin).origin;
    requestOrigin = new URL(`${request.protocol}://${request.host}`).origin;
  } catch {
    throw new AppError(403, 'FORBIDDEN', 'Malformed Origin header');
  }
  if (callerOrigin !== requestOrigin) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Origin does not match this server. If the app sits behind a reverse proxy, set TRUST_PROXY=true.',
    );
  }
}

async function authPlugin(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  await app.register(fastifyCookie);

  app.decorate('authService', options.authService);
  app.decorate('sessionStore', options.sessionStore);
  app.decorateRequest('session', undefined);
  app.decorateRequest('sessionToken', undefined);

  app.decorate('setSessionCookie', (reply, request, token, expiresAt) => {
    void reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecureRequest(request, options.config.cookieSecure),
      expires: new Date(expiresAt),
    });
  });

  app.decorate('clearSessionCookie', (reply, request) => {
    void reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecureRequest(request, options.config.cookieSecure),
    });
  });

  app.decorate('requireSession', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const session = token ? options.sessionStore.resolve(token) : undefined;
    if (!session) {
      if (token) app.clearSessionCookie(reply, request);
      void reply
        .header('WWW-Authenticate', 'Session realm="plate"')
        .status(401)
        .send(errorBody('UNAUTHENTICATED', 'Sign in to continue'));
      return reply;
    }
    request.session = session;
    request.sessionToken = token;
    return undefined;
  });

  // Runs for every route, public ones (login) included.
  app.addHook('onRequest', async (request) => {
    assertSameOrigin(request);
  });
}

export default fp(authPlugin, { name: 'plate-auth', fastify: '5.x' });
