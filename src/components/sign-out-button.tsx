"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

import { IconSignOut } from "@/components/ui/icons";

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
      className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium text-shell-muted transition-colors duration-150 ease-out-soft hover:bg-shell-raised hover:text-shell-text disabled:cursor-not-allowed disabled:opacity-60"
    >
      <IconSignOut className="size-4.5" />
      {pending ? "Çıkış yapılıyor…" : "Çıkış yap"}
    </button>
  );
}
