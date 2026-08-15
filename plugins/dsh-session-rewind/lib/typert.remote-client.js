/* 手写 typert remote-client manifest（照 message-feedback 的 typert.remote-client.js 格式）。 */
import { z } from 'zod'

const deleteParameterSchema = z.object({
  sessionId: z.string().min(1),
})

const deleteResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    value: z.object({
      deleted: z.literal(true),
      deletedIds: z.array(z.string()),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.union([
      z.object({ code: z.literal('session-not-found'), sessionId: z.string() }),
      z.object({ code: z.literal('delete-failed'), sessionId: z.string(), message: z.string() }),
    ]),
  }),
])

const rewindParameterSchema = z.object({
  sessionId: z.string().min(1),
  atSeq: z.number().int().nonnegative(),
})

const rewindResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    value: z.object({
      sessionId: z.string().nullable(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.union([
      z.object({ code: z.literal('session-not-found'), sessionId: z.string() }),
      z.object({ code: z.literal('no-prior-turn'), sessionId: z.string() }),
      z.object({ code: z.literal('fork-failed'), sessionId: z.string(), message: z.string() }),
    ]),
  }),
])

const regenerateParameterSchema = z.object({
  sessionId: z.string().min(1),
  atSeq: z.number().int().nonnegative(),
})

const regenerateResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    value: z.object({
      sessionId: z.string(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.union([
      z.object({ code: z.literal('session-not-found'), sessionId: z.string() }),
      z.object({ code: z.literal('no-prior-turn'), sessionId: z.string() }),
      z.object({ code: z.literal('no-user-message'), sessionId: z.string() }),
      z.object({ code: z.literal('fork-failed'), sessionId: z.string(), message: z.string() }),
    ]),
  }),
])

export const TYPERT_REMOTE = {
  package: '@deepseek-ai/dsh-session-rewind',
  descriptors: [
    {
      id: '@deepseek-ai/dsh-session-rewind#sessionRewind/delete',
      service: 'sessionRewind',
      namespace: 'sessionRewind',
      method: 'delete',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session-rewind/types#SessionRewindDeleteRequest',
            schema: deleteParameterSchema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-session-rewind/types#SessionRewindDeleteResult',
        schema: deleteResultSchema,
      },
    },
    {
      id: '@deepseek-ai/dsh-session-rewind#sessionRewind/rewind',
      service: 'sessionRewind',
      namespace: 'sessionRewind',
      method: 'rewind',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session-rewind/types#SessionRewindRequest',
            schema: rewindParameterSchema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-session-rewind/types#SessionRewindResult',
        schema: rewindResultSchema,
      },
    },
    {
      id: '@deepseek-ai/dsh-session-rewind#sessionRewind/regenerate',
      service: 'sessionRewind',
      namespace: 'sessionRewind',
      method: 'regenerate',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session-rewind/types#SessionRewindRegenerateRequest',
            schema: regenerateParameterSchema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-session-rewind/types#SessionRewindRegenerateResult',
        schema: regenerateResultSchema,
      },
    },
  ],
}

export default TYPERT_REMOTE
