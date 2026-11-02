import {
  apiErrorSchema,
  backupDownloadQuerySchema,
  localDayKey,
  restoreRequestSchema,
  restoreResultSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createReadStream, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { BackupService } from '../backup/service.js';

export interface BackupRouteOptions {
  backup: BackupService;
}

/** A whole database as JSON; generous because diaries grow for years. */
const RESTORE_BODY_LIMIT = 50 * 1024 * 1024;

/**
 * The day in the download's file name: the client's local day when it sent one (the server may
 * well run in UTC inside Docker), else the server's own local day.
 */
const fileDay = (day: string | undefined) => day ?? localDayKey(new Date());

export async function backupRoutes(
  app: FastifyInstance,
  options: BackupRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { backup } = options;

  r.get(
    '/backup.json',
    { schema: { querystring: backupDownloadQuerySchema } },
    async (request, reply) => {
      const document = backup.collect();
      return reply
        .type('application/json; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="plate-backup-${fileDay(request.query.day)}.json"`,
        )
        .header('Cache-Control', 'no-store')
        .send(Readable.from(backup.jsonChunks(document)));
    },
  );

  r.post(
    '/backup/restore',
    {
      bodyLimit: RESTORE_BODY_LIMIT,
      schema: {
        body: restoreRequestSchema,
        response: { 200: restoreResultSchema, 400: apiErrorSchema },
      },
    },
    async (request) => backup.restore(request.body.backup),
  );

  r.get(
    '/backup.sqlite',
    { schema: { querystring: backupDownloadQuerySchema } },
    async (request, reply) => {
      const file = backup.writeSnapshot();
      let size: number;
      let stream: ReturnType<typeof createReadStream>;
      try {
        size = statSync(file).size;
        stream = createReadStream(file);
      } catch (err) {
        // No stream to hand the clean-up to: remove the snapshot here before failing the request.
        void unlink(file).catch(() => undefined);
        throw err;
      }
      // The temp file goes as soon as the stream is done, whether the download finished or aborted.
      stream.on('close', () => void unlink(file).catch(() => undefined));
      return reply
        .type('application/vnd.sqlite3')
        .header('Content-Length', size)
        .header(
          'Content-Disposition',
          `attachment; filename="plate-${fileDay(request.query.day)}.sqlite"`,
        )
        .header('Cache-Control', 'no-store')
        .send(stream);
    },
  );
}
