import { NextResponse } from "next/server";

import { getCurrentUser, type CurrentUser } from "./current-user";

type AuthGuardResult =
  | { user: CurrentUser; response: null }
  | { user: null; response: NextResponse };

/**
 * API route handler'larında kimliği doğrulanmamış erişimi engellemek için
 * tekrar kullanılabilir temel guard. Rol/tenant bazlı yetkilendirme (RBAC)
 * bu foundation'ın kapsamı dışındadır; sadece "giriş yapılmış mı" kontrolü yapar.
 *
 * Kullanım:
 *   const { user, response } = await requireUser();
 *   if (!user) return response;
 */
export async function requireUser(): Promise<AuthGuardResult> {
  const user = await getCurrentUser();

  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { user, response: null };
}
