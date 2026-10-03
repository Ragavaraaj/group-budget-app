import { z } from 'zod';
import { DISPLAY_NAME_MAX, GROUP_NAME_MAX } from '../limits';
import { uuidSchema } from './primitives';

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const meResponseSchema = z.object({
  user: userSchema,
  /** The signed-in person's own (personal) ledger. */
  personalGroupId: uuidSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** What the login screen may offer. */
export const authConfigResponseSchema = z.object({
  google: z.boolean(),
  devLogin: z.boolean(),
});
export type AuthConfigResponse = z.infer<typeof authConfigResponseSchema>;

export const devLoginRequestSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(DISPLAY_NAME_MAX).optional(),
});

/** The installed app's one-time secret (see docs/auth.md, attempt-login). */
export const attemptSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid attempt secret');
export const attemptHashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Invalid attempt hash');

export const attemptRedeemRequestSchema = z.object({ secret: attemptSecretSchema });

export const groupNameSchema = z.string().trim().min(1).max(GROUP_NAME_MAX);
export const createGroupRequestSchema = z.object({
  id: uuidSchema.optional(),
  name: groupNameSchema,
});
export const renameGroupRequestSchema = z.object({ name: groupNameSchema });
export const groupResponseSchema = z.object({ groupId: uuidSchema });

export const createInviteResponseSchema = z.object({
  /** Shown once: only a hash is stored. Put it in a link: `/join/<token>`. */
  token: z.string(),
  expiresAt: z.number().int(),
  maxUses: z.number().int(),
});
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

/** One invite link that can still be used. The link itself is shown only once, when created. */
export const openInviteSchema = z.object({
  id: uuidSchema,
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  usedCount: z.number().int().min(0),
  maxUses: z.number().int().min(1),
});
export type OpenInvite = z.infer<typeof openInviteSchema>;
export const listInvitesResponseSchema = z.object({ invites: z.array(openInviteSchema) });
export type ListInvitesResponse = z.infer<typeof listInvitesResponseSchema>;

/** Adding or renaming someone who doesn't use the app. */
export const placeholderNameRequestSchema = z.object({
  name: z.string().trim().min(1).max(DISPLAY_NAME_MAX),
});
export const addPlaceholderResponseSchema = z.object({ userId: uuidSchema });

export const transferOwnershipRequestSchema = z.object({ userId: uuidSchema });

export const acceptInviteRequestSchema = z.object({ token: z.string().min(16).max(128) });
