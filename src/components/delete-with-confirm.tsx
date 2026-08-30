"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Onaylı silme düğmesi (Issue #130).
 *
 * NEDEN PAYLAŞILAN BİR BİLEŞEN: hesap, kategori ve işlem formları bilerek AYRI dosyalardır —
 * alanları ve doğrulamaları farklıdır. Silme ise üçünde de BİREBİR aynı davranıştır (onayla,
 * `DELETE` at, listeyi tazele); üç kopya yazmak, aynı hatayı üç yerde düzeltmek demek olurdu.
 * Farklılaşan tek şey metinler ve endpoint'tir, ikisi de prop olarak gelir.
 *
 * NEDEN `<form>` DEĞİL: HTML formları yalnızca `GET`/`POST` gönderebilir; API `DELETE` verb'ü
 * kullanır (bkz. route'lar). Bu yüzden en küçük yaprak bir client component'tir.
 *
 * NEDEN LİNK DEĞİL: silme state değiştirir; `GET` yan etkisiz kalmalıdır (invariant #4). Bir
 * link, tarayıcı ön-getirmesi veya bir crawler tarafından tetiklenebilirdi.
 *
 * ONAY İKİ ADIMLIDIR, `window.confirm()` DEĞİL: tarayıcının diyaloğu stillenemez, ekran
 * okuyucuda bağlam taşımaz ve silmenin SONUCUNU (ör. "bakiye değişecek") anlatacak yer
 * bırakmaz. Buradaki satır içi onay, o sonucu kullanıcının gözünün önüne koyar.
 */

export type DeleteMessages = {
  /** 403 — yetki yok. */
  forbidden: string;
  /** 404 — kayıt yok ya da başka tenant'a ait (ikisi ayırt EDİLMEZ; enumeration engeli). */
  notFound: string;
  /** 409 — iş kuralı engeli (ör. işlemi olan hesap silinemez). */
  conflict?: string;
  /** Ağ hatası / beklenmeyen durum. */
  fallback: string;
};

export function DeleteWithConfirm({
  endpoint,
  itemLabel,
  confirmQuestion,
  consequence,
  messages,
}: {
  endpoint: string;
  /** Erişilebilir ad için: "Kasa hesabını sil" gibi — listede çok sayıda "Sil" düğmesi olur. */
  itemLabel: string;
  confirmQuestion: string;
  /** Silmenin geri alınamaz sonucu. Kullanıcı onaylamadan ÖNCE görmelidir. */
  consequence?: string;
  messages: DeleteMessages;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setPending(true);

    try {
      const response = await fetch(endpoint, { method: "DELETE" });

      if (!response.ok) {
        if (response.status === 403) setError(messages.forbidden);
        else if (response.status === 404) setError(messages.notFound);
        else if (response.status === 409 && messages.conflict) setError(messages.conflict);
        else setError(messages.fallback);
        // Onay paneli AÇIK kalır: kullanıcı hatayı okuyup tekrar deneyebilsin ya da
        // vazgeçebilsin. Paneli kapatmak, hatanın hangi satıra ait olduğunu belirsizleştirirdi.
        return;
      }

      setConfirming(false);
      // Liste sunucuda render edilir; `refresh()` sunucu bileşenini yeni veriyle çalıştırır.
      router.refresh();
    } catch {
      setError(messages.fallback);
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-red-700 underline underline-offset-4 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
      >
        {/* Görünen metin kısa ("Sil"), erişilebilir ad uzun: ekran okuyucu kullanıcısı
            listedeki onlarca "Sil" düğmesinden hangisinde olduğunu bilmelidir. */}
        <span aria-hidden="true">Sil</span>
        <span className="sr-only">{itemLabel}</span>
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/40">
      <p className="font-medium text-red-800 dark:text-red-300">{confirmQuestion}</p>
      {consequence && <p className="text-red-700 dark:text-red-400">{consequence}</p>}

      {error && (
        <p role="alert" className="text-red-800 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Siliniyor…" : "Evet, sil"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="text-sm text-zinc-700 underline underline-offset-4 disabled:opacity-60 dark:text-zinc-300"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}
