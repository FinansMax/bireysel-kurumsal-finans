"use client";

import { useEffect, useState } from "react";

/**
 * "Doğrulama e-postasını tekrar gönder" aksiyonu (Issue #190, #232).
 *
 * MEVCUT endpoint'e gerçek HTTP isteği atar; "oturumdaki kullanıcıya tekrar gönder" diye ikinci
 * bir route AÇILMADI. Yeniden gönderme rate limiti (`RESEND_VERIFICATION`, 3/15dk) o route'ta
 * yaşıyor ve her çağrı bir e-posta üretiyor; ikinci bir kapı açmak onu limitsiz hâle getirirdi.
 * Aynı gerekçe auth ekranlarının Server Action kullanmama kararıyla birebir aynı (#36).
 *
 * NEDEN PAYLAŞILAN BİR BİLEŞEN: iki yerde kullanılıyor — `/tenants/new` formundaki 403 dalında
 * (#232) ve kabuktaki kalıcı uyarı şeridinde (#190). İkisinde de aynı invariant'ları taşıması
 * gerekiyor; kopyalamak, birinde düzeltilen bir davranışın diğerinde eski kalması demekti.
 */

/**
 * Yeniden gönderme durumu.
 *
 * "sent" NÖTR BİR ONAYDIR: `POST /api/auth/resend-verification` bilerek DAİMA aynı yanıtı döner
 * (invariant #7 — "kayıtlı ve doğrulanmamışsa gönderildi"). Arayüz o yanıtı ayrıştırıp
 * "gönderildi" / "zaten doğrulanmış" ayrımı yapmaya ÇALIŞMAZ; yapsaydı endpoint'in bilinçli
 * olarak kapattığı oracle'ı arayüz tarafında yeniden açardı.
 */
type ResendState = "idle" | "pending" | "sent" | "rateLimited" | "failed";

const RESEND_MESSAGES: Record<Exclude<ResendState, "idle" | "pending">, string> = {
  sent: "Doğrulama e-postası gönderildi. Gelen kutunuzu ve spam klasörünü kontrol edin.",
  rateLimited: "Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.",
  failed: "Doğrulama e-postası gönderilemedi. Lütfen daha sonra tekrar deneyin.",
};

/**
 * Başarılı gönderimden sonra düğmenin kapalı kaldığı süre.
 *
 * NEDEN GEREKLİ: endpoint invariant #7 gereği HER ZAMAN aynı 200'ü döner — "gönderildi" ile
 * "zaten doğrulanmış" arasında görünür bir fark yoktur. Onay satırı zaten ekrandayken ikinci
 * tıklama hiçbir şeyi değiştirmez, kullanıcı ekranın bozuk olduğunu düşünür ve tıklamaya devam
 * ederek 3/15dk limitine kendini kilitler. Düğmenin görünür şekilde tükenmesi, yanıtı
 * AYRIŞTIRMADAN verilebilecek tek dürüst geri bildirimdir.
 *
 * Bu bir rate limit DEĞİLDİR ve öyleymiş gibi davranılmaz: gerçek sınır sunucudadır. Buradaki
 * süre yalnızca bir arayüz jestidir, bu yüzden kısa tutulur — kullanıcıyı gerçekten
 * gerektiğinde tekrar denemekten alıkoymamalı.
 */
const RESEND_COOLDOWN_MS = 10_000;

export function ResendVerificationButton({
  email,
  className,
}: {
  email: string;
  /** Kullanıldığı yüzeye göre değişen düğme stili; davranış her yerde aynıdır. */
  className?: string;
}) {
  const [state, setState] = useState<ResendState>("idle");
  const [coolingDown, setCoolingDown] = useState(false);

  useEffect(() => {
    if (!coolingDown) {
      return;
    }

    const timer = setTimeout(() => setCoolingDown(false), RESEND_COOLDOWN_MS);
    // Temizlik ZORUNLU: kullanıcı bu süre içinde başka bir ekrana geçerse sökülmüş bir
    // bileşenin state'i güncellenmeye çalışılırdı.
    return () => clearTimeout(timer);
  }, [coolingDown]);

  async function resend() {
    setState("pending");

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setState("sent");
        // Cooldown YALNIZCA başarıda başlar: istek başarısız olduysa kullanıcının hemen tekrar
        // denemesini engellemek, çözebileceği bir sorunda onu bekletmek olurdu.
        setCoolingDown(true);
        return;
      }

      setState(response.status === 429 ? "rateLimited" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="space-y-2">
      {/*
        `type="button"`: bileşen bir form İÇİNDE de kullanılıyor (`/tenants/new`) ve orada formu
        göndermemeli — doğrulama hâlâ eksikken ikinci bir 403 üretirdi.
      */}
      <button
        type="button"
        onClick={resend}
        disabled={state === "pending" || coolingDown}
        className={
          className ??
          "rounded-control border border-line px-3 py-1.5 text-sm font-medium text-body transition-colors duration-150 ease-out-soft hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {state === "pending"
          ? "Gönderiliyor…"
          : coolingDown
            ? "Gönderildi"
            : "Doğrulama e-postasını tekrar gönder"}
      </button>

      {state === "sent" ? (
        <p role="status" className="text-sm text-pretty text-muted">
          {RESEND_MESSAGES.sent}
        </p>
      ) : null}

      {/*
        `role="alert"` YALNIZCA gerçek hatalarda: başarı satırı `role="status"` kullanır, aksi
        halde ekran okuyucu "gönderildi" bildirimini de bir hata gibi kesip okurdu.
      */}
      {state === "rateLimited" || state === "failed" ? (
        <p role="alert" className="text-sm text-pretty text-danger-600 dark:text-danger-300">
          {RESEND_MESSAGES[state]}
        </p>
      ) : null}
    </div>
  );
}
