"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * İki faktörlü doğrulama bölümü (Issue #229). API #193'te geldi; bu bileşen onu uçtan uca
 * kullanılabilir kılar.
 *
 * MEVCUT ROUTE'LARA GERÇEK HTTP İSTEĞİ ATAR, Server Action DEĞİL — `revoke-sessions-button.tsx`
 * ile aynı gerekçe: rate limit ve `requireUser()` route'tadır; Server Action o kapıyı atlardı.
 *
 * SIR VE KURTARMA KODLARI YALNIZCA BU BİLEŞENİN STATE'İNDE YAŞAR. `localStorage`/
 * `sessionStorage`'a yazılmaz, sunucuya geri gönderilmez, URL'e konmaz (#229 teknik
 * gereksinimi). Sayfa yenilenirse kaybolurlar — bu bilinçlidir: kurulum yarıda kalırsa baştan
 * başlatılır (`setup` her çağrıda yeni sır ve yeni kodlar üretir).
 *
 * QR KODU YOK. `otpauth://` URI'sini QR'a çevirmek bir bağımlılık gerektirir ve bu, açık onaya
 * tabidir (CLAUDE.md §4). Onaylanana kadar: sır okunaklı dörtlü gruplar hâlinde gösterilir ve
 * URI bir BAĞLANTI olarak verilir — mobilde authenticator uygulamasını doğrudan açar.
 */

type Step =
  | { kind: "idle" }
  | { kind: "codes"; secret: string; otpauthUri: string; recoveryCodes: string[] }
  | { kind: "verify"; secret: string; otpauthUri: string };

const BUTTON_PRIMARY =
  "rounded-control bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-brand-700 disabled:opacity-60";
const BUTTON_SECONDARY =
  "rounded-control border border-line px-3 py-1.5 text-sm font-medium text-body transition-colors duration-150 ease-out-soft hover:bg-surface-muted disabled:opacity-60";
const BUTTON_DANGER =
  "rounded-control bg-danger-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-danger-700 disabled:opacity-60";
const FIELD =
  "w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-strong transition-colors duration-150 ease-out-soft focus:border-brand-500";

function messageForStatus(status: number, fallback: string): string {
  switch (status) {
    case 401:
      return "Oturumunuz kapanmış. Lütfen tekrar giriş yapın.";
    case 429:
      // Sayaç/limit YAZILMAZ (invariant #7).
      return "Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar deneyin.";
    default:
      return fallback;
  }
}

/** 32 karakterlik sırrı elle yazmak için dörtlü gruplar: `ABCD EFGH ...`. */
function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-pretty text-danger-600 dark:text-danger-300">
      {message}
    </p>
  ) : null;
}

export function TwoFactorSettings({
  enabled,
  remainingRecoveryCodes,
}: {
  enabled: boolean;
  remainingRecoveryCodes: number;
}) {
  if (enabled) {
    return <EnabledState remainingRecoveryCodes={remainingRecoveryCodes} />;
  }
  return <SetupFlow />;
}

function SetupFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function begin() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/totp/setup", { method: "POST" });
      if (response.status === 409) {
        // Başka bir sekmede zaten açılmış: ekranı gerçek duruma getir.
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(messageForStatus(response.status, "Kurulum başlatılamadı. Lütfen tekrar deneyin."));
        return;
      }
      const body = (await response.json()) as {
        secret: string;
        otpauthUri: string;
        recoveryCodes: string[];
      };
      setSaved(false);
      setStep({ kind: "codes", ...body });
    } catch {
      setError("Kurulum başlatılamadı. Lütfen tekrar deneyin.");
    } finally {
      setPending(false);
    }
  }

  async function copyCodes(codes: string[]) {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      // Pano izni yoksa kodlar ekranda duruyor; kullanıcı elle kopyalayabilir.
      setCopied(false);
    }
  }

  function downloadCodes(codes: string[]) {
    // Dosya tarayıcıda üretilir (Blob): kodlar sunucuya ikinci kez GİTMEZ.
    const blob = new Blob([`FinansMax kurtarma kodları\n\n${codes.join("\n")}\n`], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "finansmax-kurtarma-kodlari.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!response.ok) {
        setError(
          response.status === 400
            ? "Kod doğrulanamadı. Uygulamadaki güncel kodu girin."
            : messageForStatus(response.status, "2FA açılamadı. Lütfen tekrar deneyin."),
        );
        return;
      }
      // Sır ve kodlar state'ten ATILIR; sunucu bileşeni "açık" durumunu yeniden çizer.
      setStep({ kind: "idle" });
      setCode("");
      router.refresh();
    } catch {
      setError("2FA açılamadı. Lütfen tekrar deneyin.");
    } finally {
      setPending(false);
    }
  }

  if (step.kind === "idle") {
    return (
      <div className="space-y-2">
        <button type="button" onClick={begin} disabled={pending} className={BUTTON_PRIMARY}>
          {pending ? "Hazırlanıyor…" : "İki faktörlü doğrulamayı aç"}
        </button>
        <ErrorText message={error} />
      </div>
    );
  }

  const secretBlock = (
    <div className="space-y-2">
      <p className="text-sm text-pretty text-muted">
        Kimlik doğrulama uygulamanıza (Google Authenticator, 1Password, Authy…) şu anahtarı
        ekleyin:
      </p>
      <p
        aria-label="Kurulum anahtarı"
        className="rounded-control bg-surface-muted px-3 py-2 font-mono text-sm tracking-wide break-all text-strong"
      >
        {groupSecret(step.secret)}
      </p>
      <p className="text-xs text-muted">
        Telefondaysanız{" "}
        <a href={step.otpauthUri} className="font-medium text-brand-600 dark:text-brand-300">
          uygulamada aç
        </a>
        . QR kod bu sürümde yok.
      </p>
    </div>
  );

  if (step.kind === "codes") {
    return (
      <div className="space-y-4">
        {secretBlock}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-strong">Kurtarma kodları</h3>
          <p className="text-sm text-pretty text-muted">
            Telefonunuzu kaybederseniz giriş yapmanın tek yolu bu kodlardır. Her biri yalnızca
            bir kez kullanılır.{" "}
            <span className="font-medium text-strong">
              Bu kodlar bir daha gösterilmeyecek — şimdi kaydedin.
            </span>
          </p>
          <ul
            aria-label="Kurtarma kodları"
            className="grid gap-1 rounded-control bg-surface-muted p-3 font-mono text-sm text-strong sm:grid-cols-2"
          >
            {step.recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copyCodes(step.recoveryCodes)}
              className={BUTTON_SECONDARY}
            >
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
            <button
              type="button"
              onClick={() => downloadCodes(step.recoveryCodes)}
              className={BUTTON_SECONDARY}
            >
              İndir (.txt)
            </button>
          </div>
        </div>

        {/* Kodları kaydettiğini onaylamayan kullanıcı doğrulama adımına GEÇEMEZ (#229): sonraki
            adımda kodlar ekrandan kalkar ve bir daha gösterilmez. */}
        <label className="flex items-start gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            className="mt-0.5"
          />
          Kurtarma kodlarımı güvenli bir yere kaydettim.
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setStep({ kind: "idle" });
              setCopied(false);
            }}
            className={BUTTON_SECONDARY}
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={!saved}
            onClick={() =>
              setStep({ kind: "verify", secret: step.secret, otpauthUri: step.otpauthUri })
            }
            className={BUTTON_PRIMARY}
          >
            Devam et
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-4" noValidate>
      {secretBlock}
      <div className="space-y-1.5">
        <label htmlFor="totp-confirm-code" className="text-sm font-medium text-strong">
          Doğrulama kodu
        </label>
        <input
          id="totp-confirm-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          disabled={pending}
          className={FIELD}
        />
        <p className="text-xs text-muted">
          Uygulamanın gösterdiği 6 haneli kodu girin. 2FA, kod doğrulanana kadar açılmaz.
        </p>
      </div>
      <ErrorText message={error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStep({ kind: "idle" })}
          disabled={pending}
          className={BUTTON_SECONDARY}
        >
          Vazgeç
        </button>
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {pending ? "Doğrulanıyor…" : "Doğrula ve aç"}
        </button>
      </div>
    </form>
  );
}

function EnabledState({ remainingRecoveryCodes }: { remainingRecoveryCodes: number }) {
  const router = useRouter();
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/totp/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(
          response.status === 400 || response.status === 403
            ? "Şifre doğrulanamadı."
            : messageForStatus(response.status, "2FA kapatılamadı. Lütfen tekrar deneyin."),
        );
        return;
      }
      setPassword("");
      setDisabling(false);
      router.refresh();
    } catch {
      setError("2FA kapatılamadı. Lütfen tekrar deneyin.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-body">
        <span className="font-medium text-strong">Açık.</span> Kalan kurtarma kodu:{" "}
        <span className="font-medium text-strong tabular-nums">{remainingRecoveryCodes}</span>
      </p>
      {remainingRecoveryCodes <= 2 ? (
        <p className="text-sm text-pretty text-muted">
          Kurtarma kodlarınız azaldı. Yeni kod almak için 2FA&apos;yı kapatıp yeniden açın.
        </p>
      ) : null}

      {disabling ? (
        // NEDEN ŞİFRE: 2FA'yı kapatmak hesabın koruma seviyesini düşürür; çalınmış bir oturum
        // cookie'si tek başına yetmemeli (README, #193).
        <form onSubmit={disable} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="totp-disable-password" className="text-sm font-medium text-strong">
              Mevcut şifre
            </label>
            <input
              id="totp-disable-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              className={FIELD}
            />
          </div>
          <ErrorText message={error} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setDisabling(false);
                setError(null);
              }}
              disabled={pending}
              className={BUTTON_SECONDARY}
            >
              Vazgeç
            </button>
            <button type="submit" disabled={pending} className={BUTTON_DANGER}>
              {pending ? "Kapatılıyor…" : "2FA'yı kapat"}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setDisabling(true)} className={BUTTON_SECONDARY}>
          İki faktörlü doğrulamayı kapat
        </button>
      )}
    </div>
  );
}
