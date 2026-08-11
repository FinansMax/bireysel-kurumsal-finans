import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { hashPassword } from "./password";
import { isValidEmail, isValidPassword, normalizeEmail } from "./validation";

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = "P2002";

export type RegisterUserInput = {
  email: unknown;
  password: unknown;
};

export type RegisteredUser = {
  id: string;
  email: string;
};

export type RegisterUserResult =
  | { ok: true; user: RegisteredUser }
  | { ok: false; status: 400 | 409; error: string };

/**
 * E-posta + şifre ile yeni bir `User` kaydı oluşturur (Issue #5).
 *
 * - Şifre asla plaintext saklanmaz/loglanmaz; sadece hash'i DB'ye yazılır.
 * - `Tenant`/`Membership` OLUŞTURMAZ — bu Epic 1'in ayrı bir issue'sunun kapsamındadır.
 * - Prisma `select` ile döndürülen kullanıcı objesine `passwordHash` hiçbir zaman dahil edilmez.
 * - Duplicate e-posta kontrolü, race condition'a açık bir "önce kontrol et" adımı yerine
 *   doğrudan `create` + unique constraint (P2002) hatasının yakalanmasıyla yapılır.
 */
export async function registerUser(input: RegisterUserInput): Promise<RegisterUserResult> {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    return { ok: false, status: 400, error: "Email and password are required" };
  }

  const email = normalizeEmail(input.email);

  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: "Invalid email address" };
  }

  if (!isValidPassword(input.password)) {
    return {
      ok: false,
      status: 400,
      error: "Password must be between 8 and 128 characters",
    };
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true },
    });

    return { ok: true, user };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
    ) {
      return { ok: false, status: 409, error: "Email is already registered" };
    }

    throw error;
  }
}
