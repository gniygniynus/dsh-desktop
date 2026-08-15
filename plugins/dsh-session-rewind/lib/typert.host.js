/* 手写 typert host manifest（照 @deepseek-ai/dsh-message-feedback 的编译产物格式）。
 * 提供 sessionRewind.delete（硬删会话）与 sessionRewind.rewind（撤回=fork+删母+子顶替）。 */
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

export const TYPERT = {
  package: '@deepseek-ai/dsh-session-rewind',
  face: 'host',
  schemas: [],
  invocations: [
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
  model: {
    services: [
      {
        description: '硬删会话与撤回（fork+删母+子顶替）host 服务。',
        summary: '会话回退服务。',
        tags: [],
        jsDoc: '',
        key: 'sessionRewind',
        exportName: 'SessionRewindService',
        members: [
          {
            kind: 'method',
            name: 'delete',
            signature: "@Remote('delete') delete(request: SessionRewindDeleteRequest): Promise<SessionRewindDeleteResult>",
            summary: '硬删一个会话及其子代理会话。',
            jsDoc: '',
          },
          {
            kind: 'method',
            name: 'rewind',
            signature: "@Remote('rewind') rewind(request: SessionRewindRequest): Promise<SessionRewindResult>",
            summary: '撤回：fork 到消息上一轮并硬删母会话，返回子会话 id。',
            jsDoc: '',
          },
          {
            kind: 'method',
            name: 'regenerate',
            signature: "@Remote('regenerate') regenerate(request: SessionRewindRegenerateRequest): Promise<SessionRewindRegenerateResult>",
            summary: '重新回答：fork 到该轮上一轮并 followup 原用户消息重跑，删母，返回子会话 id。',
            jsDoc: '',
          },
        ],
        types: [
          {
            name: 'SessionRewindDeleteRequest',
            declaration: 'export interface SessionRewindDeleteRequest { readonly sessionId: SessionId; }',
          },
          {
            name: 'SessionRewindDeleteResult',
            declaration: 'export type SessionRewindDeleteResult = SessionRewindSuccess<SessionRewindDeleteValue> | SessionRewindRejected<SessionRewindSessionNotFound | SessionRewindDeleteFailed>;',
          },
          {
            name: 'SessionRewindDeleteValue',
            declaration: 'export interface SessionRewindDeleteValue { readonly deleted: true; readonly deletedIds: readonly SessionId[]; }',
          },
          {
            name: 'SessionRewindRequest',
            declaration: 'export interface SessionRewindRequest { readonly sessionId: SessionId; readonly atSeq: number; }',
          },
          {
            name: 'SessionRewindResult',
            declaration: 'export type SessionRewindResult = SessionRewindSuccess<SessionRewindValue> | SessionRewindRejected<SessionRewindSessionNotFound | SessionRewindNoPriorTurn | SessionRewindForkFailed>;',
          },
          {
            name: 'SessionRewindValue',
            declaration: 'export interface SessionRewindValue { readonly sessionId: SessionId; }',
          },
          {
            name: 'SessionRewindSessionNotFound',
            declaration: "export interface SessionRewindSessionNotFound { readonly code: 'session-not-found'; readonly sessionId: SessionId; }",
          },
          {
            name: 'SessionRewindNoPriorTurn',
            declaration: "export interface SessionRewindNoPriorTurn { readonly code: 'no-prior-turn'; readonly sessionId: SessionId; }",
          },
          {
            name: 'SessionRewindForkFailed',
            declaration: "export interface SessionRewindForkFailed { readonly code: 'fork-failed'; readonly sessionId: SessionId; readonly message: string; }",
          },
          {
            name: 'SessionRewindDeleteFailed',
            declaration: "export interface SessionRewindDeleteFailed { readonly code: 'delete-failed'; readonly sessionId: SessionId; readonly message: string; }",
          },
          {
            name: 'SessionRewindSuccess',
            declaration: 'export interface SessionRewindSuccess<T> { readonly ok: true; readonly value: T; }',
          },
          {
            name: 'SessionRewindRejected',
            declaration: 'export interface SessionRewindRejected<E> { readonly ok: false; readonly error: E; }',
          },
          {
            name: 'SessionId',
            declaration: "export type SessionId = string & { readonly [BRAND]: 'SessionId'; };",
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
