import { auth } from "./index";

export type CurrentUser = {
  id: string;
  email: string;
  name?: string | null;
};

/**
 * Sunucu tarafında (Server Component, Route Handler) mevcut oturumun sahibi kullanıcıyı okur.
 * Oturum yoksa `null` döner.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}
