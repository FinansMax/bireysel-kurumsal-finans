"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

/**
 * Uygulama kabuğundaki çıkış düğmesi (Issue #39).
 *
 * NEDEN İSTEMCİ TARAFI `signOut` (`next-auth/react`) — ve neden sunucu tarafı DEĞİL:
 * `@/lib/auth`'un export ettiği SUNUCU `signOut()`'u (bkz. `node_modules/next-auth/lib/actions.js`)
 * bellekte bir `Request` üretip `Auth()`'u doğrudan çağırır ve `skipCSRFCheck` geçer — istek
 * `src/app/api/auth/[...nextauth]/route.ts` üzerinden HİÇ geçmez. Bu, login/signup ekranlarındaki
 * kararla birebir aynıdır (bkz. README "Auth Ekranları"); regresyon koruması:
 * `integration/auth-ui-pattern.spec.ts`.
 *
 * `callbackUrl` ile TAM SAYFA yönlendirme kasıtlıdır: `router.push()` gibi yumuşak bir gezinme,
 * Next.js'in istemci router cache'indeki daha önce render edilmiş korumalı sayfaları ekranda
 * bırakabilirdi (veri hâlâ görünürken oturum kapanmış olurdu). Tam yükleme bu cache'i tamamen
 * atar.
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        // `signOut()` sayfayı terk ettiği için `finally` ile pending'i geri almaya gerek yok;
        // hata durumunda düğmenin kilitli kalmaması için `catch` ile açılır.
        void signOut({ callbackUrl: "/login" }).catch(() => setPending(false));
      }}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
    >
      {pending ? "Çıkış yapılıyor…" : "Çıkış yap"}
    </button>
  );
}
