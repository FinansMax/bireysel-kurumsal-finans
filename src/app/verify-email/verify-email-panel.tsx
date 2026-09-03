"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Doğrulama token'ını tüketen panel (Issue #190).
 *
 * NEDEN OTOMATİK POST: kullanıcı e-postadaki linke tıklayarak zaten niyetini belirtti; bir de
 * "Doğrula" düğmesine bastırmak gereksiz bir adımdır. İşlemin POST olması ise zorunludur
 * (invariant #4) — GET olsaydı e-posta istemcisinin link ön-getirmesi token'ı kullanıcı
 * tıklamadan tüketebilirdi.
 *
 * `useRef` ile TEK ÇAĞRI garantisi: React 18+ geliştirme modunda efektler iki kez çalışır ve
 * token TEK KULLANIMLIKTIR — ikinci çağrı "geçersiz token" hatası gösterip kullanıcıyı boşuna
 * korkuturdu.
 */
type Status = "idle" | "pending" | "success" | "error";

export function VerifyEmailPanel({ token }: { token: string | null }) {
  const [status, setStatus] = useState<Status>(token ? "pending" : "error");
  const startedRef = useRef(false);

  useEffect(() => {
    if (!token || startedRef.current) {
      return;
    }
    startedRef.current = true;

    void (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        setStatus(response.ok ? "success" : "error");
      } catch {
        setStatus("error");
      }
    })();
  }, [token]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold text-strong">E-posta doğrulama</h1>

      {status === "pending" ? <p className="text-sm text-muted">Doğrulanıyor…</p> : null}

      {status === "success" ? (
        <>
          <p role="status" className="text-sm text-pretty text-body">
            E-posta adresiniz doğrulandı. Artık çalışma alanı oluşturabilir ve davetleri kabul
            edebilirsiniz.
          </p>
          <Link href="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">
            Panele git
          </Link>
        </>
      ) : null}

      {status === "error" ? (
        <>
          {/*
            HATA NEDENİ AYRIŞTIRILMAZ (invariant #7): bulunamadı / süresi doldu / zaten
            kullanıldı — hepsi aynı mesaj. Ayrıştırmak, geçerli token uzayını daraltmak için
            kullanılabilirdi.
          */}
          <p role="alert" className="text-sm text-pretty text-danger-600 dark:text-danger-300">
            Bağlantı geçersiz veya süresi dolmuş. Panelden yeni bir doğrulama e-postası
            isteyebilirsiniz.
          </p>
          <Link href="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">
            Panele git
          </Link>
        </>
      ) : null}
    </main>
  );
}
