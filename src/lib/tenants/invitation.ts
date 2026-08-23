import { createHash, randomBytes } from "node:crypto";

import { MembershipRole, Prisma } from "@prisma/client";

import { normalizeEmail, isValidEmail } from "@/lib/auth/validation";
import { getAppBaseUrl } from "@/lib/config/app-url";
import { prisma } from "@/lib/prisma";

import { consoleInvitationSender, type InvitationSender } from "./invitation-email";
import { isValidRole } from "./validation";

// 256 bit entropi — brute-force ile tahmin edilmesi hesaplama açısından imkansız
// (bkz. `src/lib/auth/password-reset.ts`'teki aynı yaklaşım).
const INVITATION_TOKEN_BYTES = 32;

// 7 gün: davet linkinin e-posta kontrolü + kabul için makul bir pencere bırakır; şifre
// sıfırlama token'ından (30 dk) kasıtlı olarak çok daha uzundur çünkü davet, davet edilen
// kişinin hemen o an online olmasını gerektirmez.
const INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// "Cancel eski pending + create yeni" transaction'ı Serializable isolation altında bile
// nadiren bir yazma çakışmasıyla (P2034) başarısız olabilir (bkz. createInvitation
// dokümantasyonu) — bu durumda birkaç kez otomatik yeniden denenir.
const MAX_CREATE_ATTEMPTS = 3;

const PRISMA_TRANSACTION_CONFLICT_ERROR_CODE = "P2034";

export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString("hex");
}

const invitationSelect = {
  id: true,
  tenantId: true,
  email: true,
  role: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.TenantInvitationSelect;

export type InvitationView = Prisma.TenantInvitationGetPayload<{ select: typeof invitationSelect }>;

export type CreateInvitationInput = { email: unknown; role: unknown };

export type CreateInvitationOptions = {
  invitationSender?: InvitationSender;
  baseUrl?: string;
};

export type CreateInvitationResult =
  | { ok: true; invitation: InvitationView }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Tenant'a yeni bir kullanıcı daveti oluşturur (Issue #14).
 *
 * Yetkilendirme ("kim davet oluşturabilir") route seviyesinde `requirePermission(PERMISSIONS.SEND_INVITE,
 * tenantId)` (Issue #12) ile yapılır; `tenantId` ve `actorRole` o guard'dan gelen, DB'den canlı
 * doğrulanmış trusted context'tir — client input DEĞİLDİR.
 *
 * Least-privilege / privilege-escalation koruması: `updateMemberRole`'daki ("ADMIN kimseyi OWNER
 * yapamaz") ile AYNI kural — ADMIN, OWNER rolüne davet oluşturamaz; sadece OWNER, OWNER daveti
 * gönderebilir.
 *
 * Duplicate pending invitation politikası: aynı tenant + aynı (normalize edilmiş) email için
 * aktif (kullanılmamış, iptal edilmemiş, süresi dolmamış olsun ya da olmasın) bir pending davet
 * varsa, yeni davet oluşturulmadan ÖNCE o davet `cancelledAt` ile geçersiz kılınır — böylece
 * eski token'ın accept edilmesi mümkün olmaz ve her zaman en fazla bir aktif davet bulunur.
 *
 * Race condition koruması: "eski pending'i iptal et + yenisini oluştur" bir Serializable
 * transaction içinde yapılır (bkz. `src/lib/tenants/membership.ts`'teki last-OWNER koruması ile
 * AYNI teknik). Aynı tenant+email için eşzamanlı iki davet oluşturma isteği, Postgres'in
 * serializable snapshot isolation'ı sayesinde phantom-read olarak tespit edilir; kaybeden istek
 * `P2034` ile başarısız olur ve otomatik olarak yeniden denenir (en fazla `MAX_CREATE_ATTEMPTS`
 * kez) — sonuçta iki eşzamanlı istekten yalnızca biri kalıcı, aktif bir davet üretir.
 */
export async function createInvitation(
  tenantId: string,
  actorRole: MembershipRole,
  actorUserId: string,
  input: CreateInvitationInput,
  options: CreateInvitationOptions = {},
): Promise<CreateInvitationResult> {
  if (typeof input.email !== "string") {
    return { ok: false, status: 400, error: "Email is required" };
  }

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: "Invalid email address" };
  }

  if (!isValidRole(input.role)) {
    return { ok: false, status: 400, error: "Invalid role" };
  }
  const role = input.role;

  // ADMIN hiç kimseyi OWNER olarak davet edemez (bkz. `updateMemberRole`'daki aynı kural,
  // Issue #12) — sadece OWNER, OWNER rolüyle davet gönderebilir.
  if (actorRole !== MembershipRole.OWNER && role === MembershipRole.OWNER) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const sender = options.invitationSender ?? consoleInvitationSender;
  // Transaction BAŞLAMADAN önce çözülür: yanlış yapılandırma durumunda hata, davet satırı
  // oluşturulmadan fırlar ve geride linki üretilememiş (kabul edilemez) bir davet kalmaz.
  const baseUrl = options.baseUrl ?? getAppBaseUrl();

  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TOKEN_TTL_MS);

  let invitation: InvitationView | undefined;

  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
    try {
      invitation = await prisma.$transaction(
        async (tx) => {
          await tx.tenantInvitation.updateMany({
            where: { tenantId, email, usedAt: null, cancelledAt: null },
            data: { cancelledAt: new Date() },
          });

          return tx.tenantInvitation.create({
            data: {
              tenantId,
              email,
              role,
              tokenHash,
              expiresAt,
              invitedByUserId: actorUserId,
            },
            select: invitationSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (error) {
      const isConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_TRANSACTION_CONFLICT_ERROR_CODE;
      if (!isConflict || attempt === MAX_CREATE_ATTEMPTS) {
        throw error;
      }
    }
  }

  if (!invitation) {
    throw new Error("createInvitation: transaction did not produce an invitation");
  }

  const acceptUrl = `${baseUrl}/invitations/accept?token=${rawToken}`;
  await sender.sendInvitationEmail({ to: email, tenantId, role, acceptUrl });

  return { ok: true, invitation };
}

export type AcceptInvitationResult =
  | { ok: true; membership: { id: string; tenantId: string; role: MembershipRole } }
  | { ok: false; status: 400 | 403 | 409; error: string };

const INVALID_OR_EXPIRED_ERROR = "Invalid or expired invitation";

class AlreadyMemberError extends Error {}
class ClaimFailedError extends Error {}

/**
 * Authenticated bir kullanıcı için bekleyen bir daveti kabul eder (Issue #14).
 *
 * GÜVENLİK: Token "bulunamadı" / "süresi dolmuş" / "zaten kullanılmış" / "iptal edilmiş"
 * durumlarının HEPSİ için AYNI genel hata mesajı dönülür (bkz. `resetPassword`'daki aynı desen)
 * — token'ın hangi durumda olduğu dışarıya sızdırılmaz.
 *
 * E-posta eşleşme kontrolü, token'ı TÜKETMEDEN (claim etmeden) ÖNCE yapılır: aksi halde yanlış
 * hesaba giriş yapmış biri geçerli bir daveti (bilerek ya da bilmeyerek) kalıcı olarak
 * yakabilirdi. Davetin `email` alanı hiçbir zaman değişmediği için bu ön-kontrol, transaction
 * içinde tekrar okumaya gerek bırakmadan güvenlidir.
 *
 * Membership creation + invitation consume tek bir transaction içinde yapılır: token claim'i
 * (`updateMany WHERE tokenHash = ? AND usedAt IS NULL AND cancelledAt IS NULL AND expiresAt > now()`)
 * `resetPassword`'daki gibi atomik tek-kazananlı bir güncelleme olduğundan, eşzamanlı iki accept
 * isteğinden sadece biri claim'i kazanır (diğeri `ClaimFailedError` ile generic hataya düşer) —
 * ayrıca Serializable izolasyona gerek yoktur (aggregate/phantom-read riski taşıyan bir sorgu yok).
 * Kullanıcı zaten üye ise transaction `AlreadyMemberError` ile rollback olur: token claim'i de
 * GERİ ALINIR (davet hâlâ kullanılabilir kalır) — duplicate membership veya privilege escalation
 * OLUŞTURULMAZ.
 */
export async function acceptInvitation(
  userId: string,
  userEmail: string,
  rawToken: unknown,
): Promise<AcceptInvitationResult> {
  if (typeof rawToken !== "string" || rawToken.length === 0) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_ERROR };
  }

  const tokenHash = hashInvitationToken(rawToken);

  const invitation = await prisma.tenantInvitation.findUnique({ where: { tokenHash } });
  if (!invitation) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_ERROR };
  }

  if (invitation.usedAt || invitation.cancelledAt || invitation.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 400, error: INVALID_OR_EXPIRED_ERROR };
  }

  if (invitation.email !== normalizeEmail(userEmail)) {
    return { ok: false, status: 403, error: "This invitation was not issued to this account" };
  }

  try {
    const membership = await prisma.$transaction(async (tx) => {
      const claim = await tx.tenantInvitation.updateMany({
        where: {
          tokenHash,
          usedAt: null,
          cancelledAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new ClaimFailedError();
      }

      const existingMembership = await tx.membership.findUnique({
        where: { userId_tenantId: { userId, tenantId: invitation.tenantId } },
        select: { id: true },
      });
      if (existingMembership) {
        throw new AlreadyMemberError();
      }

      return tx.membership.create({
        data: { userId, tenantId: invitation.tenantId, role: invitation.role },
        select: { id: true, tenantId: true, role: true },
      });
    });

    return { ok: true, membership };
  } catch (error) {
    if (error instanceof ClaimFailedError) {
      return { ok: false, status: 400, error: INVALID_OR_EXPIRED_ERROR };
    }
    if (error instanceof AlreadyMemberError) {
      return { ok: false, status: 409, error: "Already a member of this tenant" };
    }
    throw error;
  }
}
